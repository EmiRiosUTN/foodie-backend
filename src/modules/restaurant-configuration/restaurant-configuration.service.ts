import { ForbiddenException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { RequestUser } from "../../common/auth/request-user";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../prisma/prisma.service";

type PersonalizeInput = { description?: string | null; cuisineType?: string | null; address?: string | null; city?: string | null; province?: string | null; country?: string | null; phone?: string | null; email?: string | null; websiteUrl?: string | null; instagramUrl?: string | null; mapsUrl?: string | null; menuUrl?: string | null; whatsappPhone?: string | null; assistantEnabled?: boolean; assistantName?: string | null; assistantRole?: string | null; assistantLocale?: string | null; assistantTone?: string | null; assistantFirstGreeting?: string | null; assistantDisclosure?: boolean; humanSupportPhone?: string | null; humanSupportWhatsapp?: string | null; humanSupportEmail?: string | null; specials: Array<{ id?: string; title: string; description?: string | null; price?: number | null; imageUrl?: string | null; externalUrl?: string | null; isActive: boolean; startsAt: string; endsAt: string }> };

@Injectable()
export class RestaurantConfigurationService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}
  private owner(user: RequestUser) { if (user.scope !== "restaurant" || user.role !== "restaurant_owner" || !user.restaurantId) throw new ForbiddenException("Solo el dueño del restaurante puede editar la configuración"); return user.restaurantId; }

  async getPersonalize(user: RequestUser) {
    const restaurantId = this.owner(user);
    const [customization, booking, specials] = await Promise.all([
      this.prisma.restaurantCustomization.findUnique({ where: { restaurantId } }),
      this.prisma.onlineBookingSettings.findUnique({ where: { restaurantId }, select: { whatsappPhone: true } }),
      this.prisma.restaurantSpecial.findMany({ where: { restaurantId }, orderBy: [{ startsAt: "desc" }, { createdAt: "desc" }] })
    ]);
    return { description: customization?.description || null, cuisineType: customization?.cuisineType || null, address: customization?.address || null, city: customization?.city || null, province: customization?.province || null, country: customization?.country || null, phone: customization?.phone || null, email: customization?.email || null, websiteUrl: customization?.websiteUrl || null, instagramUrl: customization?.instagramUrl || null, mapsUrl: customization?.mapsUrl || null, menuUrl: customization?.menuUrl || null, whatsappPhone: booking?.whatsappPhone || null, assistantEnabled: customization?.assistantEnabled ?? true, assistantName: customization?.assistantName || null, assistantRole: customization?.assistantRole || null, assistantLocale: customization?.assistantLocale || "es-AR", assistantTone: customization?.assistantTone || "calido_breve_profesional", assistantFirstGreeting: customization?.assistantFirstGreeting || null, assistantDisclosure: customization?.assistantDisclosure ?? true, humanSupportPhone: customization?.humanSupportPhone || null, humanSupportWhatsapp: customization?.humanSupportWhatsapp || null, humanSupportEmail: customization?.humanSupportEmail || null, specials: specials.map((special) => ({ ...special, price: special.price ? Number(special.price) : null, startsAt: special.startsAt.toISOString().slice(0, 10), endsAt: special.endsAt.toISOString().slice(0, 10) })) };
  }

  async savePersonalize(user: RequestUser, input: PersonalizeInput) {
    const restaurantId = this.owner(user);
    const existingIds = new Set((await this.prisma.restaurantSpecial.findMany({ where: { restaurantId }, select: { id: true } })).map((item) => item.id));
    if (input.specials.some((special) => special.id && !existingIds.has(special.id))) throw new ForbiddenException("Especial inválido");
    await this.prisma.$transaction(async (tx) => {
      const data = { description: input.description, cuisineType: input.cuisineType, address: input.address, city: input.city, province: input.province, country: input.country, phone: input.phone, email: input.email, websiteUrl: input.websiteUrl, instagramUrl: input.instagramUrl, mapsUrl: input.mapsUrl, menuUrl: input.menuUrl, assistantEnabled: input.assistantEnabled, assistantName: input.assistantName, assistantRole: input.assistantRole, assistantLocale: input.assistantLocale || "es-AR", assistantTone: input.assistantTone || "calido_breve_profesional", assistantFirstGreeting: input.assistantFirstGreeting, assistantDisclosure: input.assistantDisclosure, humanSupportPhone: input.humanSupportPhone, humanSupportWhatsapp: input.humanSupportWhatsapp, humanSupportEmail: input.humanSupportEmail };
      await tx.restaurantCustomization.upsert({ where: { restaurantId }, create: { restaurantId, ...data }, update: { ...data, configVersion: { increment: 1 } } });
      await tx.onlineBookingSettings.upsert({ where: { restaurantId }, create: { restaurantId, whatsappPhone: input.whatsappPhone }, update: { whatsappPhone: input.whatsappPhone } });
      const retained = input.specials.flatMap((special) => special.id ? [special.id] : []);
      await tx.restaurantSpecial.deleteMany({ where: { restaurantId, ...(retained.length ? { id: { notIn: retained } } : {}) } });
      for (const special of input.specials) {
        const data = { title: special.title, description: special.description || null, price: special.price === null || special.price === undefined ? null : new Prisma.Decimal(special.price), imageUrl: special.imageUrl || null, externalUrl: special.externalUrl || null, isActive: special.isActive, startsAt: new Date(`${special.startsAt}T00:00:00.000Z`), endsAt: new Date(`${special.endsAt}T23:59:59.999Z`) };
        if (special.id) await tx.restaurantSpecial.update({ where: { id: special.id }, data }); else await tx.restaurantSpecial.create({ data: { restaurantId, ...data } });
      }
    });
    await this.audit.log({ action: "restaurant.customization.updated", targetType: "restaurant", targetId: restaurantId, restaurantId, restaurantUserId: user.sub });
    return this.getPersonalize(user);
  }
}
