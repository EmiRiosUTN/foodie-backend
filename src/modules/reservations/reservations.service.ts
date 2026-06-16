import { Injectable } from "@nestjs/common";
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import type { RequestUser } from "../../common/auth/request-user";
import { createReservationCode } from "../../common/utils/code";
import { RealtimeService } from "../realtime/realtime.service";
import { AuditService } from "../audit/audit.service";
import { ReservationStatus } from "@prisma/client";

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

  private normalizeEmail(email: string) {
    return email.trim().toLowerCase();
  }

  private normalizeOptionalEmail(email?: string) {
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

  async create(
    user: RequestUser,
    input: {
      branchId: string;
      roomId: string;
      fullName: string;
      phone: string;
      email: string;
      partySize: number;
      serviceDate: string;
      serviceTime: string;
      turn?: "mediodia" | "noche";
      preferredZone?: string;
      preferredTags?: string[];
      birthday?: string;
      notes?: string;
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
      email: string;
      partySize: number;
      serviceDate: string;
      serviceTime?: string;
      turn?: "mediodia" | "noche";
      preferredZone?: string;
      preferredTags?: string[];
      birthday?: string;
      notes?: string;
    },
    options?: { actorUserId?: string; idempotencyKey?: string }
  ) {
    const room = await this.prisma.room.findFirst({
      where: { id: input.roomId, restaurantId, branchId: input.branchId },
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

    const assignment = await this.assignTables({
      restaurantId,
      roomId: input.roomId,
      serviceDate,
      turn,
      partySize: input.partySize,
      preferredZone: input.preferredZone
    });

    if (!assignment) {
      throw new ConflictException("No valid table or combination available");
    }

    const reservation = await this.prisma.$transaction(async (tx) => {
      const normalizedInput = {
        ...input,
        email: this.normalizeEmail(input.email)
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
          email: normalizedInput.email,
          partySize: input.partySize,
          status: "confirmed",
          turn,
          serviceDate,
          serviceTime,
          preferredZone: input.preferredZone,
          notes: input.notes,
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
              tableId_serviceDate_turn: {
                tableId,
                serviceDate,
                turn
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

  async moveToState(user: RequestUser, reservationId: string, next: "seated" | "completed") {
    const restaurantId = this.restaurantScope(user);
    const reservation = await this.prisma.reservation.findFirst({
      where: { id: reservationId, restaurantId },
      include: { tables: true }
    });
    if (!reservation) throw new NotFoundException("Reservation not found");

    const nextStatus: ReservationStatus = next;
    const tableStatus = next === "seated" ? "occupied" : "free";

    const updated = await this.prisma.$transaction(async (tx) => {
      const changed = await tx.reservation.update({
        where: { id: reservationId },
        data: { status: nextStatus }
      });

      await Promise.all(
        reservation.tables.map((item) =>
          tx.serviceState.upsert({
            where: {
              tableId_serviceDate_turn: {
                tableId: item.tableId,
                serviceDate: reservation.serviceDate,
                turn: reservation.turn
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
      reservationId,
      status: nextStatus
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

    const assignment = await this.assignTables({
      restaurantId: input.restaurantId,
      roomId: input.roomId,
      serviceDate,
      turn,
      partySize: input.partySize,
      preferredZone: input.preferredZone
    });

    return {
      available: Boolean(assignment),
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
      assignment: assignment
        ? {
            tableIds: assignment.tableIds,
            tableLabels: assignment.tableLabels,
            seats: assignment.seats,
            combination: assignment.tableIds.length > 1
          }
        : null,
      reason: assignment ? null : "No valid table or combination available"
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

    const assignment = await this.assignTables({
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
      const normalizedEmail = this.normalizeEmail(input.email || reservation.email);
      const customer = await this.upsertCustomer(
        tx,
        restaurantId,
        {
          branchId: nextBranchId,
          fullName: input.fullName || reservation.fullName,
          phone: input.phone || reservation.phone,
          email: normalizedEmail,
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
          email: normalizedEmail,
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
              tableId_serviceDate_turn: {
                tableId,
                serviceDate: nextServiceDate,
                turn: nextTurn
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

  private async assignTables(input: {
    restaurantId: string;
    roomId: string;
    serviceDate: Date;
    turn: "mediodia" | "noche";
    partySize: number;
    preferredZone?: string;
    excludeReservationId?: string;
  }) {
    const roomTables = await this.prisma.table.findMany({
      where: {
        restaurantId: input.restaurantId,
        roomId: input.roomId,
        isReservable: true,
        ...(input.preferredZone ? { zoneId: input.preferredZone } : {})
      }
    });

    const takenIds = new Set(
      (
        await this.prisma.serviceState.findMany({
          where: {
            restaurantId: input.restaurantId,
            roomId: input.roomId,
            serviceDate: input.serviceDate,
            turn: input.turn,
            status: { in: ["reserved", "occupied", "blocked"] },
            ...(input.excludeReservationId ? { NOT: { reservationId: input.excludeReservationId } } : {})
          }
        })
      ).map((item) => item.tableId)
    );

    const availableTables = roomTables.filter((table) => !takenIds.has(table.id));

    const single = availableTables
      .filter((table) => table.seats >= input.partySize)
      .sort((a, b) => a.seats - b.seats)[0];

    if (single) {
      return { tableIds: [single.id], tableLabels: [single.label], seats: single.seats };
    }

    const combinations = await this.prisma.tableCombination.findMany({
      where: {
        restaurantId: input.restaurantId,
        parentTable: { roomId: input.roomId },
        childTable: { roomId: input.roomId }
      }
    });

    const validCombos = combinations
      .filter((combo) => !takenIds.has(combo.parentTableId) && !takenIds.has(combo.childTableId))
      .filter((combo) => combo.combinedSeats >= input.partySize)
      .sort((a, b) => a.combinedSeats - b.combinedSeats);

    if (!validCombos.length) {
      return null;
    }

    return {
      tableIds: [validCombos[0].parentTableId, validCombos[0].childTableId],
      tableLabels: [
        roomTables.find((table) => table.id === validCombos[0].parentTableId)?.label || validCombos[0].parentTableId,
        roomTables.find((table) => table.id === validCombos[0].childTableId)?.label || validCombos[0].childTableId
      ],
      seats: validCombos[0].combinedSeats
    };
  }

  private async upsertCustomer(
    tx: any,
    restaurantId: string,
    input: {
      branchId: string;
      fullName: string;
      phone: string;
      email: string;
      birthday?: string;
      preferredTags?: string[];
      notes?: string;
    },
    options?: {
      incrementReservationCount?: boolean;
    }
  ) {
    const normalizedEmail = this.normalizeEmail(input.email);
    const incrementReservationCount = options?.incrementReservationCount ?? true;
    const existing = await tx.customer.findFirst({
      where: {
        restaurantId,
        email: normalizedEmail
      }
    });

    const birthday = input.birthday ? new Date(input.birthday) : undefined;

    if (existing) {
      const customer = await tx.customer.update({
        where: { id: existing.id },
        data: {
          fullName: input.fullName,
          phone: input.phone,
          email: normalizedEmail,
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
        email: normalizedEmail,
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
