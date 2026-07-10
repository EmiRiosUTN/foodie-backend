import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import type { RequestUser } from "../../common/auth/request-user";
import { RealtimeService } from "../realtime/realtime.service";

type LayoutFixedItem = {
  kind: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

type TableMetadata = {
  manualFeatures?: {
    hasTvView?: boolean;
  };
  capacity?: {
    minPartySize?: number;
    maxPartySize?: number;
  };
  derivedFeatures?: {
    nearWindow?: boolean;
    nearColumn?: boolean;
    nearWall?: boolean;
    nearCorridor?: boolean;
  };
};

@Injectable()
export class FloorPlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtimeService: RealtimeService
  ) {}

  private restaurantScope(user: RequestUser) {
    if (user.scope !== "restaurant" || !user.restaurantId) {
      throw new ForbiddenException("Restaurant context required");
    }
    return user.restaurantId;
  }

  private distanceBetweenRects(
    a: { x: number; y: number; width: number; height: number },
    b: { x: number; y: number; width: number; height: number }
  ) {
    const ax2 = a.x + a.width;
    const ay2 = a.y + a.height;
    const bx2 = b.x + b.width;
    const by2 = b.y + b.height;
    const dx = Math.max(0, a.x - bx2, b.x - ax2);
    const dy = Math.max(0, a.y - by2, b.y - ay2);

    return Math.sqrt(dx * dx + dy * dy);
  }

  private deriveTableMetadata(
    table: { x: number; y: number; width: number; height: number; metadata?: Record<string, unknown> },
    items: LayoutFixedItem[]
  ): TableMetadata {
    const source = (table.metadata || {}) as TableMetadata;
    const near = (kind: LayoutFixedItem["kind"], threshold: number) =>
      items
        .filter((item) => item.kind === kind)
        .some((item) => this.distanceBetweenRects(table, item) <= threshold);

    return {
      manualFeatures: {
        hasTvView: Boolean(source.manualFeatures?.hasTvView)
      },
      capacity: {
        minPartySize: source.capacity?.minPartySize,
        maxPartySize: source.capacity?.maxPartySize
      },
      derivedFeatures: {
        nearWindow: near("window", 120),
        nearColumn: near("column", 90),
        nearWall: near("wall", 80),
        nearCorridor: near("corridor", 120)
      }
    };
  }

  list(user: RequestUser, branchId?: string) {
    const restaurantId = this.restaurantScope(user);
    return this.prisma.room.findMany({
      where: {
        restaurantId,
        ...(branchId ? { branchId } : {})
      },
      include: {
        branch: true,
        zones: true,
        tables: true
      },
      orderBy: { name: "asc" }
    });
  }

  create(
    user: RequestUser,
    input: { branchId: string; name: string; description?: string; isOutdoor?: boolean }
  ) {
    const restaurantId = this.restaurantScope(user);
    return this.prisma.room.create({
      data: {
        branchId: input.branchId,
        restaurantId,
        name: input.name,
        description: input.description,
        isOutdoor: input.isOutdoor || false
      }
    });
  }

  async update(
    user: RequestUser,
    roomId: string,
    input: { name: string; description?: string; isOutdoor?: boolean }
  ) {
    const restaurantId = this.restaurantScope(user);
    const existing = await this.prisma.room.findFirst({
      where: { id: roomId, restaurantId }
    });

    if (!existing) {
      throw new NotFoundException("Room not found");
    }

    return this.prisma.room.update({
      where: { id: roomId },
      data: {
        name: input.name,
        description: input.description,
        isOutdoor: input.isOutdoor || false
      }
    });
  }

  async remove(user: RequestUser, roomId: string) {
    const restaurantId = this.restaurantScope(user);
    const room = await this.prisma.room.findFirst({
      where: { id: roomId, restaurantId },
      include: { reservations: { take: 1 } }
    });

    if (!room) {
      throw new NotFoundException("Room not found");
    }

    if (room.reservations.length) {
      throw new ForbiddenException("Cannot delete room with reservations");
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.tableCombination.deleteMany({
        where: {
          restaurantId,
          OR: [{ parentTable: { roomId } }, { childTable: { roomId } }]
        }
      });
      await tx.serviceState.deleteMany({
        where: { restaurantId, roomId }
      });
      await tx.floorPlanItem.deleteMany({
        where: { restaurantId, roomId }
      });
      await tx.table.deleteMany({
        where: { restaurantId, roomId }
      });
      await tx.roomZone.deleteMany({
        where: { restaurantId, roomId }
      });
      await tx.room.delete({
        where: { id: roomId }
      });
    });

    return { ok: true };
  }

  async detail(user: RequestUser, roomId: string) {
    const restaurantId = this.restaurantScope(user);
    const room = await this.prisma.room.findFirst({
      where: { id: roomId, restaurantId },
      include: {
        zones: true,
        floorPlanItems: true,
        tables: true
      }
    });
    if (!room) {
      throw new NotFoundException("Room not found");
    }

    const combinations = await this.prisma.tableCombination.findMany({
      where: { restaurantId, parentTable: { roomId } }
    });

    return {
      ...room,
      combinations
    };
  }

  async replaceLayout(
    user: RequestUser,
    roomId: string,
    input: {
      zones: Array<{ id: string; name: string; slug: string }>;
      items: Array<{
        id: string;
        kind: string;
        label?: string;
        x: number;
        y: number;
        width: number;
        height: number;
        rotation?: number;
        metadata?: Record<string, unknown>;
      }>;
      tables: Array<{
        id: string;
        label: string;
        shape: string;
        seats: number;
        x: number;
        y: number;
        width: number;
        height: number;
        rotation?: number;
        isReservable: boolean;
        metadata?: Record<string, unknown>;
        zoneId?: string | null;
      }>;
      combinations: Array<{
        id: string;
        parentTableId: string;
        childTableId: string;
        combinedSeats: number;
      }>;
    }
  ) {
    const restaurantId = this.restaurantScope(user);

    const room = await this.prisma.room.findFirst({
      where: { id: roomId, restaurantId }
    });
    if (!room) throw new NotFoundException("Room not found");

    const result = await this.prisma.$transaction(async (tx) => {
      const existingTables = await tx.table.findMany({
        where: { restaurantId, roomId },
        select: {
          id: true,
          reservationLinks: { select: { id: true }, take: 1 }
        }
      });
      const protectedTableIds = new Set(
        existingTables.filter((table) => table.reservationLinks.length > 0).map((table) => table.id)
      );
      const incomingTableIds = new Set(input.tables.map((table) => table.id));
      const removableTableIds = existingTables
        .filter((table) => !incomingTableIds.has(table.id) && !protectedTableIds.has(table.id))
        .map((table) => table.id);
      const removedProtectedTables = existingTables.filter(
        (table) => protectedTableIds.has(table.id) && !incomingTableIds.has(table.id)
      );

      if (removedProtectedTables.length) {
        throw new ForbiddenException("Cannot remove tables that already have reservations");
      }

      const incomingZoneIds = new Set(input.zones.map((zone) => zone.id));
      const incomingItemIds = new Set(input.items.map((item) => item.id));
      const existingItems = await tx.floorPlanItem.findMany({
        where: { restaurantId, roomId },
        select: { id: true }
      });
      const removableItemIds = existingItems
        .filter((item) => !incomingItemIds.has(item.id))
        .map((item) => item.id);
      const existingZones = await tx.roomZone.findMany({
        where: { restaurantId, roomId },
        select: { id: true }
      });
      const removableZoneIds = existingZones
        .filter((zone) => !incomingZoneIds.has(zone.id))
        .map((zone) => zone.id);

      await tx.tableCombination.deleteMany({
        where: { restaurantId, OR: [{ parentTable: { roomId } }, { childTable: { roomId } }] }
      });

      if (removableItemIds.length) {
        await tx.floorPlanItem.deleteMany({
          where: { restaurantId, roomId, id: { in: removableItemIds } }
        });
      }

      const derivedTableInputs = input.tables.map((table) => ({
        ...table,
        metadata: this.deriveTableMetadata(table, input.items)
      }));

      for (const zone of input.zones) {
        await tx.roomZone.upsert({
          where: { id: zone.id },
          update: {
            name: zone.name,
            slug: zone.slug
          },
          create: {
            id: zone.id,
            roomId,
            restaurantId,
            name: zone.name,
            slug: zone.slug
          }
        });
      }

      for (const item of input.items) {
        await tx.floorPlanItem.upsert({
          where: { id: item.id },
          update: {
            kind: item.kind,
            label: item.label,
            x: item.x,
            y: item.y,
            width: item.width,
            height: item.height,
            rotation: item.rotation || 0,
            metadata: item.metadata as Prisma.InputJsonValue | undefined
          },
          create: {
            id: item.id,
            roomId,
            restaurantId,
            kind: item.kind,
            label: item.label,
            x: item.x,
            y: item.y,
            width: item.width,
            height: item.height,
            rotation: item.rotation || 0,
            metadata: item.metadata as Prisma.InputJsonValue | undefined
          }
        });
      }

      if (removableTableIds.length) {
        await tx.table.deleteMany({
          where: {
            restaurantId,
            roomId,
            id: { in: removableTableIds }
          }
        });
      }

      for (const table of derivedTableInputs) {
        await tx.table.upsert({
          where: { id: table.id },
          update: {
            zoneId: table.zoneId || null,
            label: table.label,
            shape: table.shape,
            seats: table.seats,
            x: table.x,
            y: table.y,
            width: table.width,
            height: table.height,
            rotation: table.rotation || 0,
            metadata: table.metadata as Prisma.InputJsonValue | undefined,
            isReservable: table.isReservable
          },
          create: {
            id: table.id,
            roomId,
            restaurantId,
            zoneId: table.zoneId || null,
            label: table.label,
            shape: table.shape,
            seats: table.seats,
            x: table.x,
            y: table.y,
            width: table.width,
            height: table.height,
            rotation: table.rotation || 0,
            metadata: table.metadata as Prisma.InputJsonValue | undefined,
            isReservable: table.isReservable
          }
        });
      }

      if (removableZoneIds.length) {
        await tx.roomZone.deleteMany({
          where: {
            restaurantId,
            roomId,
            id: { in: removableZoneIds }
          }
        });
      }

      if (input.combinations.length) {
        await tx.tableCombination.createMany({
          data: input.combinations.map((item) => ({
            id: item.id,
            restaurantId,
            parentTableId: item.parentTableId,
            childTableId: item.childTableId,
            combinedSeats: item.combinedSeats
          }))
        });
      }

      return tx.room.findUnique({
        where: { id: roomId },
        include: {
          zones: true,
          floorPlanItems: true,
          tables: true
        }
      });
    });

    this.realtimeService.publish("floor_plan.updated", { restaurantId, roomId });
    return result;
  }
}
