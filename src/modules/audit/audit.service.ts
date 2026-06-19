import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(entry: {
    action: string;
    targetType: string;
    targetId: string;
    restaurantId?: string | null;
    platformUserId?: string | null;
    restaurantUserId?: string | null;
    metadata?: Record<string, unknown>;
  }) {
    return this.prisma.auditLog.create({
      data: {
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId,
        restaurantId: entry.restaurantId || null,
        platformUserId: entry.platformUserId || null,
        restaurantUserId: entry.restaurantUserId || null,
        metadata: entry.metadata as Prisma.InputJsonValue | undefined
      }
    });
  }

  listForRestaurant(restaurantId: string, input?: { limit?: number; restaurantUserId?: string }) {
    return this.prisma.auditLog.findMany({
      where: {
        restaurantId,
        restaurantUserId: input?.restaurantUserId
      },
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(input?.limit || 80, 1), 500),
      include: {
        restaurantUser: {
          select: { id: true, fullName: true, email: true, role: true }
        },
        platformUser: {
          select: { id: true, fullName: true, email: true, role: true }
        }
      }
    });
  }
}
