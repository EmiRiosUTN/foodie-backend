import { Body, Controller, Get, Param, Post, Put, Query, Req } from "@nestjs/common";
import { z } from "zod";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import { Public } from "../../common/auth/public.decorator";
import type { RequestUser } from "../../common/auth/request-user";
import { preferredFeaturesSchema } from "../reservations/preferred-features";
import { OnlineBookingsService } from "./online-bookings.service";

const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const configSchema = z.object({
  isEnabled: z.boolean(), coverImageUrl: z.string().url().max(1000).nullable().optional(), whatsappPhone: z.string().trim().regex(/^\+?[0-9\s()\-]{7,30}$/).nullable().optional(),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/), minAdvanceMinutes: z.number().int().min(0).max(10080),
  maxAdvanceDays: z.number().int().min(1).max(365), minPartySize: z.number().int().min(1).max(100), maxPartySize: z.number().int().min(1).max(100),
  branchDurations: z.array(z.object({ branchId: z.string().min(1), durationMinutes: z.number().int().min(15).max(720) })).max(100).optional(),
  schedules: z.array(z.object({ branchId: z.string().min(1), weekday: z.number().int().min(0).max(6), isEnabled: z.boolean(), startTime: clock, endTime: clock, intervalMin: z.number().int().min(5).max(180) })).max(70),
  exceptions: z.array(z.object({ branchId: z.string().min(1), serviceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), isClosed: z.boolean(), startTime: clock.optional(), endTime: clock.optional(), intervalMin: z.number().int().min(5).max(180).optional() })).max(365)
}).refine((value) => value.maxPartySize >= value.minPartySize, "Invalid party size range");

const publicFeaturesSchema = z.preprocess((value) => typeof value === "string" && value ? value.split(",") : value, preferredFeaturesSchema.optional().default([]));
const availabilitySchema = z.object({ branch: z.string().min(1), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), partySize: z.coerce.number().int().min(1).max(100), preferredFeatures: publicFeaturesSchema });
const reservationSchema = availabilitySchema.extend({ time: clock, fullName: z.string().trim().min(2).max(120), phone: z.string().trim().min(5).max(40), notes: z.string().trim().max(1000).optional(), preferredFeatures: preferredFeaturesSchema.optional().default([]), website: z.string().max(200).optional() });

@Controller("restaurant/online-booking")
export class OnlineBookingsController {
  constructor(private readonly service: OnlineBookingsService) {}
  @Get() get(@CurrentUser() user: RequestUser) { return this.service.getOwnerConfig(user); }
  @Put() save(@CurrentUser() user: RequestUser, @Body() body: unknown) { return this.service.saveOwnerConfig(user, configSchema.parse(body)); }
}

@Public()
@Controller("public/reservations")
export class PublicOnlineBookingsController {
  constructor(private readonly service: OnlineBookingsService) {}
  @Get(":restaurantSlug") profile(@Param("restaurantSlug") slug: string) { return this.service.getPublicProfile(slug); }
  @Get(":restaurantSlug/availability") availability(@Param("restaurantSlug") slug: string, @Query() query: unknown, @Req() request: { ip?: string }) { return this.service.availability(slug, availabilitySchema.parse(query), request.ip || "unknown"); }
  @Get(":restaurantSlug/calendar") calendar(@Param("restaurantSlug") slug: string, @Query() query: unknown, @Req() request: { ip?: string }) { return this.service.calendar(slug, z.object({ branch: z.string().min(1), month: z.string().regex(/^\d{4}-\d{2}$/), partySize: z.coerce.number().int().min(1).max(100), preferredFeatures: publicFeaturesSchema }).parse(query), request.ip || "unknown"); }
  @Post(":restaurantSlug/validate-slot") validateSlot(@Param("restaurantSlug") slug: string, @Body() body: unknown, @Req() request: { ip?: string }) { return this.service.validateSlot(slug, availabilitySchema.extend({ time: clock }).parse(body), request.ip || "unknown"); }
  @Post(":restaurantSlug") create(@Param("restaurantSlug") slug: string, @Body() body: unknown, @Req() request: { ip?: string }) { return this.service.createPublicReservation(slug, reservationSchema.parse(body), request.ip || "unknown"); }
}
