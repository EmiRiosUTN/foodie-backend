import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { ReservationsService } from "./reservations.service";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import type { RequestUser } from "../../common/auth/request-user";
import { z } from "zod";

const reservationSchema = z.object({
  branchId: z.string().min(1),
  roomId: z.string().min(1),
  fullName: z.string().min(2),
  phone: z.string().min(2),
  email: z.string().email(),
  partySize: z.number().int().min(1),
  serviceDate: z.string().min(1),
  serviceTime: z.string().regex(/^\d{2}:\d{2}$/),
  turn: z.enum(["mediodia", "noche"]).optional(),
  preferredZone: z.string().optional(),
  preferredTags: z.array(z.string()).optional(),
  birthday: z.string().optional(),
  notes: z.string().optional()
});

@Controller()
export class ReservationsController {
  constructor(private readonly reservationsService: ReservationsService) {}

  @Get("restaurant/reservations")
  list(
    @CurrentUser() user: RequestUser,
    @Query("branchId") branchId: string,
    @Query("serviceDate") serviceDate: string,
    @Query("turn") turn: "mediodia" | "noche"
  ) {
    return this.reservationsService.list(user, { branchId, serviceDate, turn });
  }

  @Get("restaurant/reservations/history")
  history(
    @CurrentUser() user: RequestUser,
    @Query("branchId") branchId?: string,
    @Query("dateFrom") dateFrom?: string,
    @Query("dateTo") dateTo?: string,
    @Query("turn") turn?: "mediodia" | "noche" | "all",
    @Query("status") status?: string,
    @Query("search") search?: string
  ) {
    return this.reservationsService.history(user, { branchId, dateFrom, dateTo, turn, status, search });
  }

  @Post("restaurant/reservations")
  create(@CurrentUser() user: RequestUser, @Body() body: unknown) {
    return this.reservationsService.create(user, reservationSchema.parse(body));
  }

  @Post("restaurant/reservations/:reservationId/check-in")
  checkIn(@CurrentUser() user: RequestUser, @Param("reservationId") reservationId: string) {
    return this.reservationsService.moveToState(user, reservationId, "seated");
  }

  @Post("restaurant/reservations/:reservationId/release")
  release(@CurrentUser() user: RequestUser, @Param("reservationId") reservationId: string) {
    return this.reservationsService.moveToState(user, reservationId, "completed");
  }
}
