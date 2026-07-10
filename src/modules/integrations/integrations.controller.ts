import { Body, Controller, Get, Headers, Post, Query } from "@nestjs/common";
import { IntegrationsService } from "./integrations.service";
import { Public } from "../../common/auth/public.decorator";
import { z } from "zod";

const quoteSchema = z.object({
  restaurantId: z.string().min(1).optional(),
  branchId: z.string().min(1),
  roomId: z.string().min(1),
  partySize: z.coerce.number().int().min(1),
  serviceDate: z.string().min(1),
  serviceTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  turn: z.enum(["mediodia", "noche"]).optional(),
  preferredZone: z.string().optional()
}).refine((value) => value.serviceTime || value.turn, {
  message: "serviceTime or turn is required"
});

const externalReservationSchema = z.object({
  restaurantId: z.string().min(1).optional(),
  branchId: z.string().min(1),
  roomId: z.string().min(1),
  fullName: z.string().min(2),
  phone: z.string().min(2),
  email: z.string().email(),
  partySize: z.coerce.number().int().min(1),
  serviceDate: z.string().min(1),
  serviceTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  turn: z.enum(["mediodia", "noche"]).optional(),
  preferredZone: z.string().optional(),
  preferredTags: z.array(z.string()).optional(),
  birthday: z.string().optional(),
  notes: z.string().optional()
}).refine((value) => value.serviceTime || value.turn, {
  message: "serviceTime or turn is required"
});

const externalRoomsSchema = z.object({
  restaurantId: z.string().min(1).optional(),
  branchId: z.string().min(1).optional()
});

const cancellationSchema = z.object({
  restaurantId: z.string().min(1).optional(),
  code: z.string().min(3)
});

const reservationCodeSchema = z.object({
  restaurantId: z.string().min(1).optional(),
  code: z.string().min(3)
});

const updateReservationSchema = z.object({
  restaurantId: z.string().min(1).optional(),
  code: z.string().min(3),
  branchId: z.string().min(1).optional(),
  roomId: z.string().min(1).optional(),
  fullName: z.string().min(2).optional(),
  phone: z.string().min(2).optional(),
  email: z.string().email().optional(),
  partySize: z.coerce.number().int().min(1).optional(),
  serviceDate: z.string().min(1).optional(),
  serviceTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  turn: z.enum(["mediodia", "noche"]).optional(),
  preferredZone: z.string().nullable().optional(),
  preferredTags: z.array(z.string()).optional(),
  birthday: z.string().nullable().optional(),
  notes: z.string().nullable().optional()
});

@Controller()
export class IntegrationsController {
  constructor(private readonly integrationsService: IntegrationsService) {}

  @Get("integrations/events")
  health() {
    return this.integrationsService.recentEvents();
  }

  @Public()
  @Get("external/rooms")
  listExternalRooms(
    @Headers("x-api-key") apiKey: string,
    @Query("restaurantId") restaurantId?: string,
    @Query("branchId") branchId?: string
  ) {
    return this.integrationsService.listExternalRooms(apiKey, externalRoomsSchema.parse({ restaurantId, branchId }));
  }

  @Public()
  @Post("external/reservations/quote")
  quoteExternalReservation(@Headers("x-api-key") apiKey: string, @Body() body: unknown) {
    return this.integrationsService.quoteExternalReservation(apiKey, quoteSchema.parse(body));
  }

  @Public()
  @Post("external/reservations")
  externalReservation(
    @Headers("x-api-key") apiKey: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown
  ) {
    return this.integrationsService.createExternalReservation(
      apiKey,
      externalReservationSchema.parse(body),
      idempotencyKey
    );
  }

  @Public()
  @Post("external/reservations/update")
  updateExternalReservation(
    @Headers("x-api-key") apiKey: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown
  ) {
    return this.integrationsService.updateExternalReservation(apiKey, updateReservationSchema.parse(body), idempotencyKey);
  }

  @Public()
  @Post("external/reservations/cancel")
  cancelExternalReservation(
    @Headers("x-api-key") apiKey: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown
  ) {
    return this.integrationsService.cancelExternalReservation(apiKey, cancellationSchema.parse(body), idempotencyKey);
  }

  @Public()
  @Post("external/reservations/check-in")
  checkInExternalReservation(
    @Headers("x-api-key") apiKey: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown
  ) {
    return this.integrationsService.checkInExternalReservation(apiKey, reservationCodeSchema.parse(body), idempotencyKey);
  }

  @Public()
  @Post("external/reservations/release")
  releaseExternalReservation(
    @Headers("x-api-key") apiKey: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown
  ) {
    return this.integrationsService.releaseExternalReservation(apiKey, reservationCodeSchema.parse(body), idempotencyKey);
  }

  @Public()
  @Get("external/customers/find")
  findExternalCustomer(
    @Headers("x-api-key") apiKey: string,
    @Query("restaurantId") restaurantId?: string,
    @Query("email") email?: string,
    @Query("phone") phone?: string
  ) {
    return this.integrationsService.findExternalCustomer(apiKey, { restaurantId, email, phone });
  }

  @Public()
  @Get("external/reservations/find")
  findExternalReservation(
    @Headers("x-api-key") apiKey: string,
    @Query("restaurantId") restaurantId?: string,
    @Query("code") code?: string,
    @Query("phone") phone?: string,
    @Query("serviceDate") serviceDate?: string
  ) {
    return this.integrationsService.findExternalReservation(apiKey, { restaurantId, code, phone, serviceDate });
  }
}
