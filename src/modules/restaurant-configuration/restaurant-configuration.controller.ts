import { Body, Controller, Get, Put } from "@nestjs/common";
import { z } from "zod";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import type { RequestUser } from "../../common/auth/request-user";
import { RestaurantConfigurationService } from "./restaurant-configuration.service";

const optionalUrl = z.union([z.string().url().max(1000), z.literal(""), z.null()]).optional().transform((value) => value || null);
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional().transform((value) => value || null);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const specialSchema = z.object({ id: z.string().cuid().optional(), title: z.string().trim().min(2).max(120), description: optionalText(1000), price: z.number().nonnegative().max(9_999_999).nullable().optional(), imageUrl: optionalUrl, externalUrl: optionalUrl, isActive: z.boolean(), startsAt: date, endsAt: date }).refine((value) => value.endsAt >= value.startsAt, "La vigencia final debe ser posterior al inicio");
const faqSchema = z.object({ id: z.string().cuid().optional(), topic: z.string().trim().min(2).max(80), question: z.string().trim().min(4).max(300), answer: z.string().trim().min(2).max(2000), isActive: z.boolean() });
const updateBase = { id: z.string().cuid().optional(), title: z.string().trim().min(2).max(120), category: z.enum(["menu", "hours", "event", "promotion", "general"]), content: z.string().trim().min(2).max(3000), isActive: z.boolean() };
const assistantUpdateSchema = z.union([
  z.object({ ...updateBase, validityType: z.literal("indefinite"), startsAt: z.null().optional(), endsAt: z.null().optional() }),
  z.object({ ...updateBase, validityType: z.literal("single_date"), startsAt: date, endsAt: date }).refine((value) => value.startsAt === value.endsAt, "Un evento de fecha puntual debe tener la misma fecha de inicio y fin"),
  z.object({ ...updateBase, validityType: z.literal("range"), startsAt: date, endsAt: date }).refine((value) => value.endsAt >= value.startsAt, "La fecha final debe ser posterior al inicio")
]);
const customizationSchema = z.object({ description: optionalText(500), cuisineType: optionalText(120), address: optionalText(300), city: optionalText(120), province: optionalText(120), country: optionalText(120), phone: optionalText(40), email: z.union([z.string().email(), z.literal(""), z.null()]).optional().transform((value) => value || null), websiteUrl: optionalUrl, instagramUrl: optionalUrl, mapsUrl: optionalUrl, menuUrl: optionalUrl, whatsappPhone: z.union([z.string().trim().regex(/^\+?[0-9\s()\-]{7,30}$/), z.literal(""), z.null()]).optional().transform((value) => value || null), assistantEnabled: z.boolean().optional().default(true), assistantName: optionalText(80), assistantRole: optionalText(120), assistantLocale: optionalText(20), assistantTone: optionalText(80), assistantFirstGreeting: optionalText(500), assistantDisclosure: z.boolean().optional().default(true), humanSupportPhone: optionalText(40), humanSupportWhatsapp: optionalText(40), humanSupportEmail: z.union([z.string().email(), z.literal(""), z.null()]).optional().transform((value) => value || null), specials: z.array(specialSchema).max(100), faqs: z.array(faqSchema).max(100), assistantUpdates: z.array(assistantUpdateSchema).max(100) });

@Controller("restaurant/configuration")
export class RestaurantConfigurationController {
  constructor(private readonly service: RestaurantConfigurationService) {}
  @Get("personalize") getPersonalize(@CurrentUser() user: RequestUser) { return this.service.getPersonalize(user); }
  @Put("personalize") savePersonalize(@CurrentUser() user: RequestUser, @Body() body: unknown) { return this.service.savePersonalize(user, customizationSchema.parse(body)); }
}
