import { Injectable } from "@nestjs/common";
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { RealtimeService } from "../realtime/realtime.service";
import type { RequestUser } from "../../common/auth/request-user";

@Injectable()
export class TablesService {
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

  listStates(user: RequestUser, input: { branchId: string; serviceDate: string; turn: "mediodia" | "noche" }) {
    const restaurantId = this.restaurantScope(user);
    return this.prisma.serviceState.findMany({
      where: {
        restaurantId,
        branchId: input.branchId,
        serviceDate: new Date(input.serviceDate),
        turn: input.turn
      }
    });
  }

  async setState(
    user: RequestUser,
    input: {
      tableId: string;
      roomId: string;
      branchId: string;
      reservationId?: string | null;
      serviceDate: string;
      turn: "mediodia" | "noche";
      status: "free" | "reserved" | "occupied" | "blocked";
    }
  ) {
    const restaurantId = this.restaurantScope(user);
    const table = await this.prisma.table.findFirst({
      where: {
        id: input.tableId,
        restaurantId,
        roomId: input.roomId
      }
    });

    if (!table) {
      throw new NotFoundException("Table not found in this restaurant room");
    }

    const state = await this.prisma.serviceState.upsert({
      where: {
        tableId_serviceDate_turn: {
          tableId: input.tableId,
          serviceDate: new Date(input.serviceDate),
          turn: input.turn
        }
      },
      update: {
        status: input.status,
        reservationId: input.reservationId || null,
        roomId: input.roomId,
        branchId: input.branchId
      },
      create: {
        restaurantId,
        branchId: input.branchId,
        roomId: input.roomId,
        tableId: input.tableId,
        reservationId: input.reservationId || null,
        serviceDate: new Date(input.serviceDate),
        turn: input.turn,
        status: input.status
      }
    });

    this.realtimeService.publish("table.state.changed", {
      restaurantId,
      roomId: input.roomId,
      tableId: input.tableId,
      status: input.status
    });

    return state;
  }
}
