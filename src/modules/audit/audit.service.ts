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
    metadata?: Record<string, unknown>;
  }) {
    return this.prisma.auditLog.create({
      data: {
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId,
        restaurantId: entry.restaurantId || null,
        platformUserId: entry.platformUserId || null,
        metadata: entry.metadata as Prisma.InputJsonValue | undefined
      }
    });
  }
}
