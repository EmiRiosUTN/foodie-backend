import { Injectable } from "@nestjs/common";
import { ConflictException, ForbiddenException, HttpException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { ReservationsService } from "../reservations/reservations.service";
import { verifyPassword } from "../../common/security/password";
import { RealtimeService } from "../realtime/realtime.service";
import { createRequestHash } from "../../common/utils/code";
import { AuditService } from "../audit/audit.service";
import { hashOpaqueToken } from "../../common/security/token-hash";

type ResolvedIntegrationToken = {
  id: string;
  restaurantId: string;
  isGlobal: boolean;
};

@Injectable()
export class IntegrationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reservationsService: ReservationsService,
    private readonly realtimeService: RealtimeService,
    private readonly auditService: AuditService
  ) {}

  recentEvents() {
    return this.realtimeService.recent();
  }

  async quoteExternalReservation(
    apiKey: string,
    input: {
      restaurantId?: string;
      branchId: string;
      roomId: string;
      partySize: number;
      serviceDate: string;
      serviceTime?: string;
      turn?: "mediodia" | "noche";
      preferredZone?: string;
    }
  ) {
    const token = await this.resolveToken(apiKey, input.restaurantId);
    if (!token) {
      throw new ForbiddenException("Invalid API key");
    }

    await this.consumeRateLimit(token.restaurantId);

    const quote = await this.reservationsService.quoteReservationForRestaurant({
      restaurantId: token.restaurantId,
      branchId: input.branchId,
      roomId: input.roomId,
      partySize: input.partySize,
      serviceDate: input.serviceDate,
      serviceTime: input.serviceTime,
      turn: input.turn,
      preferredZone: input.preferredZone
    });

    await this.prisma.integrationToken.update({
      where: { id: token.id },
      data: { lastUsedAt: new Date() }
    });

    return quote;
  }

  async createExternalReservation(
    apiKey: string,
    input: {
      restaurantId?: string;
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
    idempotencyKey?: string
  ) {
    const token = await this.resolveToken(apiKey, input.restaurantId);
    if (!token) {
      throw new ForbiddenException("Invalid API key");
    }

    await this.consumeRateLimit(token.restaurantId);
    const requestHash = createRequestHash(input);

    let existingRequest: {
      id: string;
      requestHash: string;
      status: "success" | "error";
      responseData: unknown;
    } | null = null;

    if (idempotencyKey) {
      existingRequest = await this.prisma.externalApiRequest.findFirst({
        where: {
          restaurantId: token.restaurantId,
          action: "create_reservation",
          idempotencyKey
        },
        select: {
          id: true,
          requestHash: true,
          status: true,
          responseData: true
        }
      });

      if (existingRequest && existingRequest.requestHash !== requestHash) {
        throw new ConflictException("Idempotency key already used with a different payload");
      }

      if (existingRequest?.status === "success" && existingRequest.responseData) {
        return existingRequest.responseData;
      }
    }

    const requestLog = existingRequest
      ? await this.prisma.externalApiRequest.update({
          where: { id: existingRequest.id },
          data: {
            integrationTokenId: token.id,
            requestHash,
            status: "error",
            responseData: Prisma.DbNull,
            errorMessage: null,
            processedAt: null
          }
        })
      : await this.prisma.externalApiRequest.create({
          data: {
            restaurantId: token.restaurantId,
            integrationTokenId: token.id,
            action: "create_reservation",
            idempotencyKey,
            requestHash,
            status: "error"
          }
        });

    try {
      const { restaurantId: _restaurantId, ...reservationInput } = input;
      const created = await this.reservationsService.createReservationForRestaurant(
        token.restaurantId,
        reservationInput,
        { idempotencyKey }
      );

      await this.prisma.$transaction([
        this.prisma.externalApiRequest.update({
          where: { id: requestLog.id },
          data: {
            status: "success",
            responseData: created,
            processedAt: new Date()
          }
        }),
        this.prisma.integrationToken.update({
          where: { id: token.id },
          data: { lastUsedAt: new Date() }
        })
      ]);

      await this.auditService.log({
        action: "external_reservation.created",
        targetType: "integration_token",
        targetId: token.id,
        restaurantId: token.restaurantId,
        metadata: { idempotencyKey: idempotencyKey || null }
      });

      return created;
    } catch (error) {
      await this.prisma.externalApiRequest.update({
        where: { id: requestLog.id },
        data: {
          status: "error",
          errorMessage: error instanceof Error ? error.message : "Unknown external reservation error",
          processedAt: new Date()
        }
      });
      throw error;
    }
  }

  async updateExternalReservation(
    apiKey: string,
    input: {
      restaurantId?: string;
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
    idempotencyKey?: string
  ) {
    const token = await this.resolveToken(apiKey, input.restaurantId);
    if (!token) {
      throw new ForbiddenException("Invalid API key");
    }

    await this.consumeRateLimit(token.restaurantId);
    const requestHash = createRequestHash(input);

    let existingRequest: {
      id: string;
      requestHash: string;
      status: "success" | "error";
      responseData: unknown;
    } | null = null;

    if (idempotencyKey) {
      existingRequest = await this.prisma.externalApiRequest.findFirst({
        where: {
          restaurantId: token.restaurantId,
          action: "update_reservation",
          idempotencyKey
        },
        select: {
          id: true,
          requestHash: true,
          status: true,
          responseData: true
        }
      });

      if (existingRequest && existingRequest.requestHash !== requestHash) {
        throw new ConflictException("Idempotency key already used with a different payload");
      }

      if (existingRequest?.status === "success" && existingRequest.responseData) {
        return existingRequest.responseData;
      }
    }

    const requestLog = existingRequest
      ? await this.prisma.externalApiRequest.update({
          where: { id: existingRequest.id },
          data: {
            integrationTokenId: token.id,
            requestHash,
            status: "error",
            responseData: Prisma.DbNull,
            errorMessage: null,
            processedAt: null
          }
        })
      : await this.prisma.externalApiRequest.create({
          data: {
            restaurantId: token.restaurantId,
            integrationTokenId: token.id,
            action: "update_reservation",
            idempotencyKey,
            requestHash,
            status: "error"
          }
        });

    try {
      const { restaurantId: _restaurantId, ...reservationInput } = input;
      const updated = await this.reservationsService.updateReservationForRestaurant(
        token.restaurantId,
        reservationInput,
        { idempotencyKey }
      );

      await this.prisma.$transaction([
        this.prisma.externalApiRequest.update({
          where: { id: requestLog.id },
          data: {
            status: "success",
            responseData: updated,
            processedAt: new Date()
          }
        }),
        this.prisma.integrationToken.update({
          where: { id: token.id },
          data: { lastUsedAt: new Date() }
        })
      ]);

      await this.auditService.log({
        action: "external_reservation.updated",
        targetType: "reservation",
        targetId: updated.id,
        restaurantId: token.restaurantId,
        metadata: { code: input.code, idempotencyKey: idempotencyKey || null }
      });

      return updated;
    } catch (error) {
      await this.prisma.externalApiRequest.update({
        where: { id: requestLog.id },
        data: {
          status: "error",
          errorMessage: error instanceof Error ? error.message : "Unknown external reservation update error",
          processedAt: new Date()
        }
      });
      throw error;
    }
  }

  async cancelExternalReservation(apiKey: string, input: { restaurantId?: string; code: string }, idempotencyKey?: string) {
    const token = await this.resolveToken(apiKey, input.restaurantId);
    if (!token) {
      throw new ForbiddenException("Invalid API key");
    }

    await this.consumeRateLimit(token.restaurantId);

    let existingRequest:
      | {
          status: "success" | "error";
          responseData: unknown;
        }
      | null = null;

    if (idempotencyKey) {
      existingRequest = await this.prisma.externalApiRequest.findFirst({
        where: {
          restaurantId: token.restaurantId,
          action: "cancel_reservation",
          idempotencyKey
        },
        select: {
          status: true,
          responseData: true
        }
      });

      if (existingRequest?.status === "success" && existingRequest.responseData) {
        return existingRequest.responseData;
      }
    }

    const requestLog = await this.prisma.externalApiRequest.create({
      data: {
        restaurantId: token.restaurantId,
        integrationTokenId: token.id,
        action: "cancel_reservation",
        idempotencyKey,
        requestHash: createRequestHash(input),
        status: "error"
      }
    });

    const reservation = await this.prisma.reservation.findFirst({
      where: { restaurantId: token.restaurantId, code: input.code }
    });
    if (!reservation) {
      throw new ForbiddenException("Reservation not found for this token");
    }

    await this.prisma.reservation.update({
      where: { id: reservation.id },
      data: { status: "cancelled" }
    });

    await this.prisma.serviceState.updateMany({
      where: {
        restaurantId: token.restaurantId,
        reservationId: reservation.id
      },
      data: {
        status: "free",
        reservationId: null
      }
    });

    this.realtimeService.publish("reservation.cancelled", {
      restaurantId: token.restaurantId,
      reservationId: reservation.id
    });

    await this.prisma.integrationToken.update({
      where: { id: token.id },
      data: { lastUsedAt: new Date() }
    });

    await this.auditService.log({
      action: "external_reservation.cancelled",
      targetType: "reservation",
      targetId: reservation.id,
      restaurantId: token.restaurantId,
      metadata: { code: input.code }
    });

    const result = { ok: true, code: input.code };

    await this.prisma.externalApiRequest.update({
      where: { id: requestLog.id },
      data: {
        status: "success",
        responseData: result,
        processedAt: new Date()
      }
    });

    return result;
  }

  async checkInExternalReservation(apiKey: string, input: { restaurantId?: string; code: string }, idempotencyKey?: string) {
    return this.transitionExternalReservation(apiKey, input, "check_in_reservation", "seated", idempotencyKey);
  }

  async releaseExternalReservation(apiKey: string, input: { restaurantId?: string; code: string }, idempotencyKey?: string) {
    return this.transitionExternalReservation(apiKey, input, "release_reservation", "completed", idempotencyKey);
  }

  private async transitionExternalReservation(
    apiKey: string,
    input: { restaurantId?: string; code: string },
    action: "check_in_reservation" | "release_reservation",
    nextStatus: "seated" | "completed",
    idempotencyKey?: string
  ) {
    const token = await this.resolveToken(apiKey, input.restaurantId);
    if (!token) {
      throw new ForbiddenException("Invalid API key");
    }

    await this.consumeRateLimit(token.restaurantId);
    const requestHash = createRequestHash(input);

    let existingRequest:
      | {
          id: string;
          requestHash: string;
          status: "success" | "error";
          responseData: unknown;
        }
      | null = null;

    if (idempotencyKey) {
      existingRequest = await this.prisma.externalApiRequest.findFirst({
        where: {
          restaurantId: token.restaurantId,
          action,
          idempotencyKey
        },
        select: {
          id: true,
          requestHash: true,
          status: true,
          responseData: true
        }
      });

      if (existingRequest && existingRequest.requestHash !== requestHash) {
        throw new ConflictException("Idempotency key already used with a different payload");
      }

      if (existingRequest?.status === "success" && existingRequest.responseData) {
        return existingRequest.responseData;
      }
    }

    const requestLog = existingRequest
      ? await this.prisma.externalApiRequest.update({
          where: { id: existingRequest.id },
          data: {
            integrationTokenId: token.id,
            requestHash,
            status: "error",
            responseData: Prisma.DbNull,
            errorMessage: null,
            processedAt: null
          }
        })
      : await this.prisma.externalApiRequest.create({
          data: {
            restaurantId: token.restaurantId,
            integrationTokenId: token.id,
            action,
            idempotencyKey,
            requestHash,
            status: "error"
          }
        });

    try {
      const updated = await this.reservationsService.moveReservationToStateForRestaurant(
        token.restaurantId,
        { code: input.code },
        nextStatus,
        { idempotencyKey: idempotencyKey || null }
      );

      await this.prisma.$transaction([
        this.prisma.externalApiRequest.update({
          where: { id: requestLog.id },
          data: {
            status: "success",
            responseData: updated,
            processedAt: new Date()
          }
        }),
        this.prisma.integrationToken.update({
          where: { id: token.id },
          data: { lastUsedAt: new Date() }
        })
      ]);

      await this.auditService.log({
        action: nextStatus === "seated" ? "external_reservation.checked_in" : "external_reservation.completed",
        targetType: "reservation",
        targetId: updated.id,
        restaurantId: token.restaurantId,
        metadata: { code: input.code, idempotencyKey: idempotencyKey || null }
      });

      return updated;
    } catch (error) {
      await this.prisma.externalApiRequest.update({
        where: { id: requestLog.id },
        data: {
          status: "error",
          errorMessage: error instanceof Error ? error.message : "Unknown external reservation transition error",
          processedAt: new Date()
        }
      });
      throw error;
    }
  }

  async findExternalCustomer(apiKey: string, input: { restaurantId?: string; email?: string; phone?: string }) {
    const token = await this.resolveToken(apiKey, input.restaurantId);
    if (!token) {
      throw new ForbiddenException("Invalid API key");
    }

    await this.consumeRateLimit(token.restaurantId);

    const customer = await this.reservationsService.findCustomerForRestaurant(token.restaurantId, {
      email: input.email,
      phone: input.phone
    });

    await this.prisma.integrationToken.update({
      where: { id: token.id },
      data: { lastUsedAt: new Date() }
    });

    return customer;
  }

  async findExternalReservation(apiKey: string, input: { restaurantId?: string; code?: string; phone?: string; serviceDate?: string }) {
    const token = await this.resolveToken(apiKey, input.restaurantId);
    if (!token) {
      throw new ForbiddenException("Invalid API key");
    }

    await this.consumeRateLimit(token.restaurantId);

    const reservation = await this.reservationsService.findReservationForRestaurant(token.restaurantId, {
      code: input.code,
      phone: input.phone,
      serviceDate: input.serviceDate
    });

    await this.prisma.integrationToken.update({
      where: { id: token.id },
      data: { lastUsedAt: new Date() }
    });

    return reservation;
  }

  private async resolveToken(apiKey: string, restaurantId?: string): Promise<ResolvedIntegrationToken | null> {
    if (!apiKey) return null;

    const globalApiKey = process.env.FOODIE_EXTERNAL_API_KEY || process.env.FOODIE_GLOBAL_API_KEY;
    if (globalApiKey && apiKey === globalApiKey) {
      if (!restaurantId) {
        throw new ForbiddenException("restaurantId is required when using global API key");
      }

      const restaurant = await this.prisma.restaurant.findFirst({
        where: { id: restaurantId, isActive: true },
        select: { id: true }
      });
      if (!restaurant) {
        throw new ForbiddenException("Restaurant not found for global API key");
      }

      const tokenHash = hashOpaqueToken(apiKey);
      const token = await this.prisma.integrationToken.upsert({
        where: {
          id: `global_${restaurantId}`
        },
        update: {
          tokenHash,
          isActive: true,
          label: "Global external API key"
        },
        create: {
          id: `global_${restaurantId}`,
          restaurantId,
          label: "Global external API key",
          tokenHash,
          isActive: true
        },
        select: { id: true, restaurantId: true }
      });

      return { ...token, isGlobal: true };
    }

    const hashedApiKey = hashOpaqueToken(apiKey);
    const directMatch = await this.prisma.integrationToken.findFirst({
      where: {
        tokenHash: hashedApiKey,
        isActive: true
      },
      include: { restaurant: true }
    });
    if (directMatch) {
      if (restaurantId && directMatch.restaurantId !== restaurantId) {
        throw new ForbiddenException("API key does not belong to requested restaurant");
      }
      return { id: directMatch.id, restaurantId: directMatch.restaurantId, isGlobal: false };
    }

    const legacyTokens = await this.prisma.integrationToken.findMany({
      where: { isActive: true },
      include: { restaurant: true }
    });

    const legacyToken = legacyTokens.find((candidate) => verifyPassword(apiKey, candidate.tokenHash));
    if (!legacyToken) return null;
    if (restaurantId && legacyToken.restaurantId !== restaurantId) {
      throw new ForbiddenException("API key does not belong to requested restaurant");
    }
    return { id: legacyToken.id, restaurantId: legacyToken.restaurantId, isGlobal: false };
  }

  private async consumeRateLimit(restaurantId: string) {
    const lastMinute = new Date(Date.now() - 60_000);
    const count = await this.prisma.externalApiRequest.count({
      where: {
        restaurantId,
        createdAt: { gte: lastMinute }
      }
    });

    if (count >= 30) {
      throw new HttpException("Rate limit exceeded", 429);
    }
  }
}
