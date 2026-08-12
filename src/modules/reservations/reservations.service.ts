import { Injectable } from "@nestjs/common";
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import type { RequestUser } from "../../common/auth/request-user";
import { createReservationCode } from "../../common/utils/code";
import { RealtimeService } from "../realtime/realtime.service";
import { AuditService } from "../audit/audit.service";
import { Prisma, ReservationSource, ReservationStatus } from "@prisma/client";
import { getSharedTableFeatures, tableMatchesPreferredFeatures, type PreferredFeature } from "./preferred-features";

@Injectable()
export class ReservationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtimeService: RealtimeService,
    private readonly auditService: AuditService
  ) {}

  private restaurantScope(user: RequestUser) {
    if (user.scope !== "restaurant" || !user.restaurantId) {
      throw new ForbiddenException("Restaurant context required");
    }
    return user.restaurantId;
  }

  private normalizeOptionalEmail(email?: string | null) {
    const value = email?.trim();
    return value ? value.toLowerCase() : undefined;
  }

  private normalizeServiceTime(serviceTime?: string, fallbackTurn?: "mediodia" | "noche") {
    if (!serviceTime) {
      return fallbackTurn === "mediodia" ? "13:00" : "20:00";
    }

    const match = /^(\d{2}):(\d{2})$/.exec(serviceTime);
    if (!match) {
      throw new BadRequestException("Invalid service time");
    }

    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours > 23 || minutes > 59) {
      throw new BadRequestException("Invalid service time");
    }

    return serviceTime;
  }

  private deriveTurnFromServiceTime(serviceTime: string): "mediodia" | "noche" {
    const hours = Number(serviceTime.slice(0, 2));
    return hours < 17 ? "mediodia" : "noche";
  }

  list(user: RequestUser, input: { branchId: string; serviceDate: string; turn: "mediodia" | "noche" }) {
    const restaurantId = this.restaurantScope(user);
    return this.prisma.reservation.findMany({
      where: {
        restaurantId,
        branchId: input.branchId,
        serviceDate: new Date(input.serviceDate),
        turn: input.turn
      },
      include: {
        room: true,
        customer: { include: { tags: true } },
        tables: { include: { table: true } }
      },
      orderBy: [{ serviceTime: "asc" }, { createdAt: "desc" }]
    });
  }

  history(
    user: RequestUser,
    input: {
      branchId?: string;
      dateFrom?: string;
      dateTo?: string;
      turn?: "mediodia" | "noche" | "all";
      status?: string;
      search?: string;
    }
  ) {
    const restaurantId = this.restaurantScope(user);
    const dateFrom = input.dateFrom ? new Date(input.dateFrom) : undefined;
    const dateTo = input.dateTo ? new Date(input.dateTo) : undefined;

    if ((input.dateFrom && (!dateFrom || Number.isNaN(dateFrom.getTime()))) || (input.dateTo && (!dateTo || Number.isNaN(dateTo.getTime())))) {
      throw new BadRequestException("Invalid date range");
    }

    const search = input.search?.trim();

    return this.prisma.reservation.findMany({
      where: {
        restaurantId,
        ...(input.branchId ? { branchId: input.branchId } : {}),
        ...(input.turn && input.turn !== "all" ? { turn: input.turn } : {}),
        ...(input.status && input.status !== "all" ? { status: input.status as ReservationStatus } : {}),
        ...(dateFrom || dateTo
          ? {
              serviceDate: {
                ...(dateFrom ? { gte: dateFrom } : {}),
                ...(dateTo ? { lte: dateTo } : {})
              }
            }
          : {}),
        ...(search
          ? {
              OR: [
                { fullName: { contains: search, mode: "insensitive" } },
                { phone: { contains: search, mode: "insensitive" } },
                { email: { contains: search, mode: "insensitive" } },
                { code: { contains: search, mode: "insensitive" } }
              ]
            }
          : {})
      },
      include: {
        branch: true,
        room: true,
        customer: { include: { tags: true } },
        tables: { include: { table: true } }
      },
      orderBy: [{ serviceDate: "desc" }, { serviceTime: "asc" }, { createdAt: "desc" }],
      take: 1000
    });
  }

  async create(
    user: RequestUser,
    input: {
      branchId: string;
      roomId: string;
      fullName: string;
      phone: string;
      email?: string | null;
      partySize: number;
      serviceDate: string;
      serviceTime: string;
      turn?: "mediodia" | "noche";
      preferredZone?: string;
      preferredFeatures?: PreferredFeature[];
      preferredTags?: string[];
      birthday?: string;
      notes?: string;
      durationMinutes?: number;
    }
  ) {
    const restaurantId = this.restaurantScope(user);
    return this.createReservationForRestaurant(restaurantId, input, { actorUserId: user.sub });
  }

  async createReservationForRestaurant(
    restaurantId: string,
    input: {
      branchId: string;
      roomId: string;
      fullName: string;
      phone: string;
      email?: string | null;
      partySize: number;
      serviceDate: string;
      serviceTime?: string;
      turn?: "mediodia" | "noche";
      preferredZone?: string;
      preferredFeatures?: PreferredFeature[];
      preferredTags?: string[];
      birthday?: string;
      notes?: string;
      durationMinutes?: number;
    },
    options?: { actorUserId?: string; idempotencyKey?: string; source?: ReservationSource }
  ) {
    const room = await this.prisma.room.findFirst({
      where: { id: input.roomId, restaurantId, branchId: input.branchId, isActive: true },
      include: { tables: true }
    });
    if (!room) {
      throw new NotFoundException("Room not found");
    }

    const serviceDate = new Date(input.serviceDate);
    if (Number.isNaN(serviceDate.getTime())) {
      throw new BadRequestException("Invalid service date");
    }
    const serviceTime = this.normalizeServiceTime(input.serviceTime, input.turn);
    const turn = this.deriveTurnFromServiceTime(serviceTime);
    const durationMinutes = input.durationMinutes || 180;

    const preferredFeatures = input.preferredFeatures || [];
    const requestedAssignment = await this.assignTables(this.prisma, {
      restaurantId,
      roomId: input.roomId,
      serviceDate,
      turn,
      partySize: input.partySize,
      preferredZone: input.preferredZone,
      preferredFeatures
      , serviceTime, durationMinutes
    });

    if (!requestedAssignment) {
      const generalAssignment = preferredFeatures.length
        ? await this.assignTables(this.prisma, {
            restaurantId,
            roomId: input.roomId,
            serviceDate,
            turn,
            partySize: input.partySize,
            preferredZone: input.preferredZone
            , serviceTime, durationMinutes
          })
        : null;
      if (preferredFeatures.length) {
        throw new ConflictException({
          code: "PREFERRED_FEATURE_UNAVAILABLE",
          message: "No hay mesas disponibles que cumplan las caracteristicas solicitadas.",
          preferredFeatures,
          generalAvailability: Boolean(generalAssignment)
        });
      }
      throw new ConflictException("No valid table or combination available");
    }

    const reservation = await this.prisma.$transaction(async (tx) => {
      // Serializes assignment attempts within a room. This prevents two public
      // requests from both seeing the same last table before either commits.
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Table" WHERE "roomId" = ${input.roomId} FOR UPDATE`);
      const assignment = await this.assignTables(tx, {
        restaurantId,
        roomId: input.roomId,
        serviceDate,
        turn,
        partySize: input.partySize,
        preferredZone: input.preferredZone,
        preferredFeatures,
        serviceTime,
        durationMinutes
      });
      if (!assignment) {
        const generalAssignment = preferredFeatures.length
          ? await this.assignTables(tx, {
              restaurantId,
              roomId: input.roomId,
              serviceDate,
              turn,
              partySize: input.partySize,
              preferredZone: input.preferredZone,
              serviceTime,
              durationMinutes
            })
          : null;
        if (preferredFeatures.length) {
          throw new ConflictException({
            code: "PREFERRED_FEATURE_UNAVAILABLE",
            message: "No hay mesas disponibles que cumplan las caracteristicas solicitadas.",
            preferredFeatures,
            generalAvailability: Boolean(generalAssignment)
          });
        }
        throw new ConflictException("No valid table or combination available");
      }
      const normalizedInput = {
        ...input,
        email: this.normalizeOptionalEmail(input.email)
      };
      const customer = await this.upsertCustomer(tx, restaurantId, normalizedInput, {
        incrementReservationCount: true
      });
      const created = await tx.reservation.create({
        data: {
          restaurantId,
          branchId: input.branchId,
          roomId: input.roomId,
          customerId: customer.id,
          code: createReservationCode(),
          fullName: input.fullName,
          phone: input.phone,
          email: normalizedInput.email ?? null,
          partySize: input.partySize,
          status: "confirmed",
          turn,
          serviceDate,
          serviceTime,
          preferredZone: input.preferredZone,
          notes: input.notes,
          source: options?.source || "admin",
          durationMinutes,
          metadata: {
            seatingPreference: {
              requestedFeatures: preferredFeatures,
              matched: true,
              assignedFeatures: assignment.features,
              assignedTableIds: assignment.tableIds,
              assignedTableLabels: assignment.tableLabels
            }
          } as Prisma.InputJsonValue,
          tables: {
            createMany: {
              data: assignment.tableIds.map((tableId) => ({ tableId }))
            }
          }
        },
        include: {
          room: true,
          customer: { include: { tags: true } },
          tables: { include: { table: true } }
        }
      });

      await Promise.all(
        assignment.tableIds.map((tableId) =>
          tx.serviceState.upsert({
            where: {
              tableId_reservationId: {
                tableId,
                reservationId: created.id
              }
            },
            update: {
              status: "reserved",
              roomId: input.roomId,
              branchId: input.branchId,
              reservationId: created.id
            },
            create: {
              restaurantId,
              branchId: input.branchId,
              roomId: input.roomId,
              tableId,
              reservationId: created.id,
              serviceDate,
              turn,
              status: "reserved"
            }
          })
        )
      );

      return created;
    });

    this.realtimeService.publish("reservation.created", {
      restaurantId,
      branchId: input.branchId,
      roomId: input.roomId,
      reservationId: reservation.id
    });

    await this.auditService.log({
      action: "reservation.created",
      targetType: "reservation",
      targetId: reservation.id,
      restaurantId,
      metadata: {
        actorUserId: options?.actorUserId || null,
        idempotencyKey: options?.idempotencyKey || null
      }
    });

    return reservation;
  }

  private timeToMinutes(serviceTime: string) {
    const [hours, minutes] = serviceTime.split(":").map(Number);
    return hours * 60 + minutes;
  }

  async findAvailableRoomForRestaurant(input: {
    restaurantId: string;
    branchId: string;
    partySize: number;
    serviceDate: string;
    serviceTime: string;
    preferredFeatures?: PreferredFeature[];
    durationMinutes?: number;
  }) {
    const serviceDate = new Date(input.serviceDate);
    if (Number.isNaN(serviceDate.getTime())) throw new BadRequestException("Invalid service date");
    const serviceTime = this.normalizeServiceTime(input.serviceTime);
    const turn = this.deriveTurnFromServiceTime(serviceTime);
    const rooms = await this.prisma.room.findMany({
      where: { restaurantId: input.restaurantId, branchId: input.branchId, isActive: true },
      orderBy: { createdAt: "asc" }
    });
    for (const room of rooms) {
      const assignment = await this.assignTables(this.prisma, {
        restaurantId: input.restaurantId,
        roomId: room.id,
        serviceDate,
        turn,
        partySize: input.partySize,
        preferredFeatures: input.preferredFeatures || []
        , serviceTime, durationMinutes: input.durationMinutes || 180
      });
      if (assignment) return { roomId: room.id, serviceTime, turn };
    }
    return null;
  }

  async moveToState(user: RequestUser, reservationId: string, next: "seated" | "completed") {
    const restaurantId = this.restaurantScope(user);
    return this.moveReservationToStateForRestaurant(restaurantId, { reservationId }, next, { actorUserId: user.sub });
  }

  async moveReservationToStateForRestaurant(
    restaurantId: string,
    input: { reservationId?: string; code?: string },
    next: "seated" | "completed",
    options?: { actorUserId?: string | null; idempotencyKey?: string | null }
  ) {
    const reservation = await this.prisma.reservation.findFirst({
      where: {
        restaurantId,
        ...(input.reservationId ? { id: input.reservationId } : {}),
        ...(input.code ? { code: input.code } : {})
      },
      include: { tables: true }
    });
    if (!reservation) throw new NotFoundException("Reservation not found");

    if (reservation.status === "cancelled") {
      throw new ConflictException("Cancelled reservation cannot be changed");
    }

    if (next === "seated" && reservation.status === "completed") {
      throw new ConflictException("Completed reservation cannot be checked in");
    }

    const nextStatus: ReservationStatus = next;
    const tableStatus = next === "seated" ? "occupied" : "free";

    const updated = await this.prisma.$transaction(async (tx) => {
      const changed = await tx.reservation.update({
        where: { id: reservation.id },
        data: { status: nextStatus },
        include: {
          room: true,
          branch: true,
          customer: { include: { tags: true } },
          tables: { include: { table: true } }
        }
      });

      await Promise.all(
        reservation.tables.map((item) =>
          tx.serviceState.upsert({
            where: {
              tableId_reservationId: {
                tableId: item.tableId,
                reservationId: reservation.id
              }
            },
            update: {
              status: tableStatus,
              reservationId: next === "completed" ? null : reservation.id
            },
            create: {
              restaurantId,
              branchId: reservation.branchId,
              roomId: reservation.roomId,
              tableId: item.tableId,
              reservationId: next === "completed" ? null : reservation.id,
              serviceDate: reservation.serviceDate,
              turn: reservation.turn,
              status: tableStatus
            }
          })
        )
      );

      return changed;
    });

    this.realtimeService.publish("reservation.updated", {
      restaurantId,
      reservationId: reservation.id,
      status: nextStatus
    });

    await this.auditService.log({
      action: next === "seated" ? "reservation.checked_in" : "reservation.completed",
      targetType: "reservation",
      targetId: reservation.id,
      restaurantId,
      restaurantUserId: options?.actorUserId || null,
      metadata: {
        code: reservation.code,
        idempotencyKey: options?.idempotencyKey || null
      }
    });

    return updated;
  }

  async quoteReservationForRestaurant(input: {
    restaurantId: string;
    branchId: string;
    roomId: string;
    partySize: number;
    serviceDate: string;
    serviceTime?: string;
    turn?: "mediodia" | "noche";
    preferredZone?: string;
    preferredFeatures?: PreferredFeature[];
  }) {
    const room = await this.prisma.room.findFirst({
      where: {
        id: input.roomId,
        restaurantId: input.restaurantId,
        branchId: input.branchId
      },
      include: {
        zones: true
      }
    });

    if (!room) {
      throw new NotFoundException("Room not found");
    }

    const serviceDate = new Date(input.serviceDate);
    if (Number.isNaN(serviceDate.getTime())) {
      throw new BadRequestException("Invalid service date");
    }
    const serviceTime = this.normalizeServiceTime(input.serviceTime, input.turn);
    const turn = this.deriveTurnFromServiceTime(serviceTime);
    const preferredFeatures = input.preferredFeatures || [];
    const preferredAssignment = await this.assignTables(this.prisma, {
      restaurantId: input.restaurantId,
      roomId: input.roomId,
      serviceDate,
      turn,
      partySize: input.partySize,
      preferredZone: input.preferredZone,
      preferredFeatures
    });
    const generalAssignment = preferredAssignment || !preferredFeatures.length
      ? null
      : await this.assignTables(this.prisma, {
          restaurantId: input.restaurantId,
          roomId: input.roomId,
          serviceDate,
          turn,
          partySize: input.partySize,
          preferredZone: input.preferredZone
        });
    const status = preferredAssignment
      ? "preferred_available"
      : generalAssignment
        ? "general_only"
        : "unavailable";

    return {
      available: Boolean(preferredAssignment || generalAssignment),
      status,
      branchId: input.branchId,
      roomId: input.roomId,
      turn,
      serviceDate: serviceDate.toISOString(),
      serviceTime,
      partySize: input.partySize,
      room: {
        id: room.id,
        name: room.name,
        isOutdoor: room.isOutdoor
      },
      preferredZone: input.preferredZone || null,
      preference: {
        requested: preferredFeatures,
        matched: Boolean(preferredAssignment)
      },
      assignment: preferredAssignment
        ? {
            tableIds: preferredAssignment.tableIds,
            tableLabels: preferredAssignment.tableLabels,
            seats: preferredAssignment.seats,
            combination: preferredAssignment.tableIds.length > 1,
            features: preferredAssignment.features
          }
        : null,
      reason: preferredAssignment || generalAssignment ? null : "No valid table or combination available"
    };
  }

  async findCustomerForRestaurant(restaurantId: string, input: { email?: string; phone?: string }) {
    const normalizedEmail = this.normalizeOptionalEmail(input.email);
    const normalizedPhone = input.phone?.trim();

    if (!normalizedEmail && !normalizedPhone) {
      throw new BadRequestException("Email or phone is required");
    }

    return this.prisma.customer.findFirst({
      where: {
        restaurantId,
        OR: [
          ...(normalizedEmail ? [{ email: normalizedEmail }] : []),
          ...(normalizedPhone ? [{ phone: normalizedPhone }] : [])
        ]
      },
      include: {
        tags: true,
        reservations: {
          include: {
            room: true,
            tables: { include: { table: true } }
          },
          orderBy: { serviceDate: "desc" },
          take: 10
        }
      }
    });
  }

  async findReservationForRestaurant(
    restaurantId: string,
    input: { code?: string; phone?: string; serviceDate?: string }
  ) {
    const normalizedPhone = input.phone?.trim();
    const serviceDate = input.serviceDate ? new Date(input.serviceDate) : undefined;

    if (!input.code && !normalizedPhone) {
      throw new BadRequestException("Reservation code or phone is required");
    }

    if (input.serviceDate && serviceDate && Number.isNaN(serviceDate.getTime())) {
      throw new BadRequestException("Invalid service date");
    }

    return this.prisma.reservation.findFirst({
      where: {
        restaurantId,
        ...(input.code ? { code: input.code } : {}),
        ...(normalizedPhone ? { phone: normalizedPhone } : {}),
        ...(serviceDate ? { serviceDate } : {})
      },
      include: {
        room: true,
        branch: true,
        customer: { include: { tags: true } },
        tables: { include: { table: true } }
      },
      orderBy: { createdAt: "desc" }
    });
  }

  async updateReservationForRestaurant(
    restaurantId: string,
    input: {
      code: string;
      branchId?: string;
      roomId?: string;
      fullName?: string;
      phone?: string;
      email?: string;
      partySize?: number;
      serviceDate?: string;
      serviceTime?: string;
      turn?: "mediodia" | "noche";
      preferredZone?: string | null;
      preferredTags?: string[];
      birthday?: string | null;
      notes?: string | null;
    },
    options?: { actorUserId?: string; idempotencyKey?: string }
  ) {
    const reservation = await this.prisma.reservation.findFirst({
      where: {
        restaurantId,
        code: input.code
      },
      include: {
        customer: true,
        tables: true
      }
    });

    if (!reservation) {
      throw new NotFoundException("Reservation not found");
    }

    if (["cancelled", "completed", "no_show", "seated"].includes(reservation.status)) {
      throw new ConflictException("Reservation can no longer be updated");
    }

    const nextBranchId = input.branchId || reservation.branchId;
    const nextRoomId = input.roomId || reservation.roomId;
    const nextPartySize = input.partySize || reservation.partySize;
    const nextServiceDate = input.serviceDate ? new Date(input.serviceDate) : reservation.serviceDate;
    const nextServiceTime = this.normalizeServiceTime(input.serviceTime ?? reservation.serviceTime, input.turn || reservation.turn);
    const nextTurn = this.deriveTurnFromServiceTime(nextServiceTime);

    if (Number.isNaN(nextServiceDate.getTime())) {
      throw new BadRequestException("Invalid service date");
    }

    const room = await this.prisma.room.findFirst({
      where: {
        id: nextRoomId,
        restaurantId,
        branchId: nextBranchId
      }
    });

    if (!room) {
      throw new NotFoundException("Room not found");
    }

    const assignment = await this.assignTables(this.prisma, {
      restaurantId,
      roomId: nextRoomId,
      serviceDate: nextServiceDate,
      turn: nextTurn,
      partySize: nextPartySize,
      preferredZone: input.preferredZone === null ? undefined : input.preferredZone || reservation.preferredZone || undefined,
      excludeReservationId: reservation.id
    });

    if (!assignment) {
      throw new ConflictException("No valid table or combination available");
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const normalizedEmail = input.email !== undefined
        ? this.normalizeOptionalEmail(input.email)
        : reservation.email;
      const customer = await this.upsertCustomer(
        tx,
        restaurantId,
        {
          branchId: nextBranchId,
          fullName: input.fullName || reservation.fullName,
          phone: input.phone || reservation.phone,
          email: normalizedEmail ?? null,
          birthday:
            input.birthday === null
              ? undefined
              : input.birthday !== undefined
                ? input.birthday
                : reservation.customer?.birthday
                  ? reservation.customer.birthday.toISOString().slice(0, 10)
                  : undefined,
          preferredTags: input.preferredTags,
          notes: input.notes === null ? undefined : input.notes ?? reservation.notes ?? undefined
        },
        {
          incrementReservationCount: false
        }
      );

      await tx.reservationTable.deleteMany({
        where: { reservationId: reservation.id }
      });

      await tx.serviceState.updateMany({
        where: {
          restaurantId,
          reservationId: reservation.id
        },
        data: {
          status: "free",
          reservationId: null
        }
      });

      const nextReservation = await tx.reservation.update({
        where: { id: reservation.id },
        data: {
          branchId: nextBranchId,
          roomId: nextRoomId,
          customerId: customer.id,
          fullName: input.fullName || reservation.fullName,
          phone: input.phone || reservation.phone,
          email: normalizedEmail ?? null,
          partySize: nextPartySize,
          serviceDate: nextServiceDate,
          serviceTime: nextServiceTime,
          turn: nextTurn,
          preferredZone: input.preferredZone === null ? null : input.preferredZone ?? reservation.preferredZone,
          notes: input.notes === null ? null : input.notes ?? reservation.notes,
          tables: {
            createMany: {
              data: assignment.tableIds.map((tableId) => ({ tableId }))
            }
          }
        },
        include: {
          room: true,
          branch: true,
          customer: { include: { tags: true } },
          tables: { include: { table: true } }
        }
      });

      await Promise.all(
        assignment.tableIds.map((tableId) =>
          tx.serviceState.upsert({
            where: {
              tableId_reservationId: {
                tableId,
                reservationId: reservation.id
              }
            },
            update: {
              status: "reserved",
              roomId: nextRoomId,
              branchId: nextBranchId,
              reservationId: reservation.id
            },
            create: {
              restaurantId,
              branchId: nextBranchId,
              roomId: nextRoomId,
              tableId,
              reservationId: reservation.id,
              serviceDate: nextServiceDate,
              turn: nextTurn,
              status: "reserved"
            }
          })
        )
      );

      return nextReservation;
    });

    this.realtimeService.publish("reservation.updated", {
      restaurantId,
      branchId: updated.branchId,
      roomId: updated.roomId,
      reservationId: updated.id
    });

    await this.auditService.log({
      action: "reservation.updated",
      targetType: "reservation",
      targetId: updated.id,
      restaurantId,
      metadata: {
        actorUserId: options?.actorUserId || null,
        idempotencyKey: options?.idempotencyKey || null,
        externalCode: input.code
      }
    });

    return updated;
  }

  private async assignTables(
    client: PrismaService | Prisma.TransactionClient,
    input: {
      restaurantId: string;
      roomId: string;
      serviceDate: Date;
      turn: "mediodia" | "noche";
      partySize: number;
      preferredZone?: string;
      preferredFeatures?: PreferredFeature[];
      excludeReservationId?: string;
      serviceTime?: string;
      durationMinutes?: number;
    }
  ) {
    const roomTables = await client.table.findMany({
      where: {
        restaurantId: input.restaurantId,
        roomId: input.roomId,
        isReservable: true,
        ...(input.preferredZone ? { zoneId: input.preferredZone } : {})
      }
    });

    const requestedStart = this.timeToMinutes(input.serviceTime || "20:00");
    const requestedEnd = requestedStart + (input.durationMinutes || 180);
    const reservations = await client.reservation.findMany({
      where: {
        restaurantId: input.restaurantId,
        roomId: input.roomId,
        serviceDate: input.serviceDate,
        status: { notIn: ["cancelled", "completed", "no_show"] },
        ...(input.excludeReservationId ? { NOT: { id: input.excludeReservationId } } : {})
      },
      select: { serviceTime: true, durationMinutes: true, tables: { select: { tableId: true } } }
    });
    const takenIds = new Set(reservations.flatMap((reservation) => {
      const start = this.timeToMinutes(reservation.serviceTime);
      const overlaps = requestedStart < start + reservation.durationMinutes && start < requestedEnd;
      return overlaps ? reservation.tables.map((item) => item.tableId) : [];
    }));
    const blockedIds = await client.serviceState.findMany({ where: { restaurantId: input.restaurantId, roomId: input.roomId, serviceDate: input.serviceDate, turn: input.turn, status: "blocked" }, select: { tableId: true } });
    blockedIds.forEach((item) => takenIds.add(item.tableId));

    const preferredFeatures = input.preferredFeatures || [];
    const availableTables = roomTables
      .filter((table) => !takenIds.has(table.id))
      .filter((table) => tableMatchesPreferredFeatures(table, preferredFeatures));

    const single = availableTables
      .filter((table) => table.seats >= input.partySize)
      .sort((a, b) => a.seats - b.seats)[0];

    if (single) {
      return {
        tableIds: [single.id],
        tableLabels: [single.label],
        seats: single.seats,
        features: getSharedTableFeatures([single])
      };
    }

    const combinations = await client.tableCombination.findMany({
      where: {
        restaurantId: input.restaurantId,
        parentTable: { roomId: input.roomId },
        childTable: { roomId: input.roomId }
      }
    });
    const availableTableIds = new Set(availableTables.map((table) => table.id));
    const validCombos = combinations
      .filter((combo) => availableTableIds.has(combo.parentTableId) && availableTableIds.has(combo.childTableId))
      .filter((combo) => combo.combinedSeats >= input.partySize)
      .sort((a, b) => a.combinedSeats - b.combinedSeats);

    if (!validCombos.length) return null;

    const selected = validCombos[0];
    const tables = [
      availableTables.find((table) => table.id === selected.parentTableId),
      availableTables.find((table) => table.id === selected.childTableId)
    ].filter((table): table is (typeof availableTables)[number] => Boolean(table));

    return {
      tableIds: [selected.parentTableId, selected.childTableId],
      tableLabels: tables.map((table) => table.label),
      seats: selected.combinedSeats,
      features: getSharedTableFeatures(tables)
    };
  }
  private async upsertCustomer(
    tx: any,
    restaurantId: string,
    input: {
      branchId: string;
      fullName: string;
      phone: string;
      email?: string | null;
      birthday?: string;
      preferredTags?: string[];
      notes?: string;
    },
    options?: {
      incrementReservationCount?: boolean;
    }
  ) {
    const normalizedEmail = this.normalizeOptionalEmail(input.email);
    const incrementReservationCount = options?.incrementReservationCount ?? true;
    // Sin email no hay una clave confiable para identificar a la persona.
    // Se crea un cliente nuevo para evitar unificar contactos distintos.
    const existing = normalizedEmail
      ? await tx.customer.findFirst({
          where: {
            restaurantId,
            email: normalizedEmail
          }
        })
      : null;

    const birthday = input.birthday ? new Date(input.birthday) : undefined;

    if (existing) {
      const customer = await tx.customer.update({
        where: { id: existing.id },
        data: {
          fullName: input.fullName,
          phone: input.phone,
          email: normalizedEmail ?? null,
          birthday,
          notes: input.notes,
          reservationCount: incrementReservationCount
            ? {
                increment: 1
              }
            : undefined
        }
      });

      if (input.preferredTags?.length) {
        await tx.customerTag.deleteMany({ where: { restaurantId, customerId: existing.id } });
        await tx.customerTag.createMany({
          data: input.preferredTags.map((label) => ({
            restaurantId,
            customerId: existing.id,
            label
          }))
        });
      }

      return customer;
    }

    const customer = await tx.customer.create({
      data: {
        restaurantId,
        branchId: input.branchId,
        fullName: input.fullName,
        phone: input.phone,
        email: normalizedEmail ?? null,
        birthday,
        notes: input.notes,
        reservationCount: incrementReservationCount ? 1 : 0
      }
    });

    if (input.preferredTags?.length) {
      await tx.customerTag.createMany({
        data: input.preferredTags.map((label) => ({
          restaurantId,
          customerId: customer.id,
          label
        }))
      });
    }

    return customer;
  }
}
