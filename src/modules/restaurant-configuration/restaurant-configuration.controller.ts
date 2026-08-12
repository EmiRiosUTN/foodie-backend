import { Body, Controller, Get, Put } from "@nestjs/common";
import { z } from "zod";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import type { RequestUser } from "../../common/auth/request-user";
import { RestaurantConfigurationService } from "./restaurant-configuration.service";

const optionalUrl = z.union([z.string().url().max(1000), z.literal("")]).optional().transform((value) => value || null);
const specialSchema = z.object({ id: z.string().cuid().optional(), title: z.string().trim().min(2).max(120), description: z.string().trim().max(1000).optional().transform((value) => value || null), price: z.number().nonnegative().max(9_999_999).nullable().optional(), imageUrl: optionalUrl, externalUrl: optionalUrl, isActive: z.boolean(), startsAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), endsAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).refine((value) => value.endsAt >= value.startsAt, "La vigencia final debe ser posterior al inicio");
const optionalText = (max: number) => z.string().trim().max(max).optional().transform((value) => value || null);
const customizationSchema = z.object({ description: optionalText(500), cuisineType: optionalText(120), address: optionalText(300), city: optionalText(120), province: optionalText(120), country: optionalText(120), phone: optionalText(40), email: z.union([z.string().email(), z.literal("")]).optional().transform((value) => value || null), websiteUrl: optionalUrl, instagramUrl: optionalUrl, mapsUrl: optionalUrl, menuUrl: optionalUrl, whatsappPhone: z.union([z.string().trim().regex(/^\+?[0-9\s()\-]{7,30}$/), z.literal("")]).optional().transform((value) => value || null), assistantEnabled: z.boolean().optional().default(true), assistantName: optionalText(80), assistantRole: optionalText(120), assistantLocale: optionalText(20), assistantTone: optionalText(80), assistantFirstGreeting: optionalText(500), assistantDisclosure: z.boolean().optional().default(true), humanSupportPhone: optionalText(40), humanSupportWhatsapp: optionalText(40), humanSupportEmail: z.union([z.string().email(), z.literal("")]).optional().transform((value) => value || null), specials: z.array(specialSchema).max(100) });

@Controller("restaurant/configuration")
export class RestaurantConfigurationController {
  constructor(private readonly service: RestaurantConfigurationService) {}
  @Get("personalize") getPersonalize(@CurrentUser() user: RequestUser) { return this.service.getPersonalize(user); }
  @Put("personalize") savePersonalize(@CurrentUser() user: RequestUser, @Body() body: unknown) { return this.service.savePersonalize(user, customizationSchema.parse(body)); }
}
