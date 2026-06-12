import { Body, Controller, Get, Post, Query } from "@nestjs/common";
import { TablesService } from "./tables.service";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import type { RequestUser } from "../../common/auth/request-user";
import { z } from "zod";

const serviceStateSchema = z.object({
  tableId: z.string().min(1),
  roomId: z.string().min(1),
  branchId: z.string().min(1),
  reservationId: z.string().optional().nullable(),
  serviceDate: z.string().min(1),
  turn: z.enum(["mediodia", "noche"]),
  status: z.enum(["free", "reserved", "occupied", "blocked"])
});

@Controller("restaurant/tables")
export class TablesController {
  constructor(private readonly tablesService: TablesService) {}

  @Get("states")
  listStates(
    @CurrentUser() user: RequestUser,
    @Query("branchId") branchId: string,
    @Query("serviceDate") serviceDate: string,
    @Query("turn") turn: "mediodia" | "noche"
  ) {
    return this.tablesService.listStates(user, { branchId, serviceDate, turn });
  }

  @Post("states")
  setState(@CurrentUser() user: RequestUser, @Body() body: unknown) {
    return this.tablesService.setState(user, serviceStateSchema.parse(body));
  }
}
