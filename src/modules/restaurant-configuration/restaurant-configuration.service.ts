import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { RequestUser } from "../../common/auth/request-user";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../prisma/prisma.service";

type SpecialInput = { id?: string; title: string; description?: string | null; price?: number | null; imageUrl?: string | null; externalUrl?: string | null; isActive: boolean; startsAt: string; endsAt: string };
type FaqInput = { id?: string; topic: string; question: string; answer: string; isActive: boolean };
type AssistantUpdateInput = { id?: string; title: string; category: "menu" | "hours" | "event" | "promotion" | "general"; content: string; isActive: boolean; validityType: "indefinite" | "single_date" | "range"; startsAt?: string | null; endsAt?: string | null };
type OpeningHourInput = { weekday: number; startTime: string; endTime: string; endsNextDay: boolean };
type PersonalizeInput = { description?: string | null; cuisineType?: string | null; address?: string | null; city?: string | null; province?: string | null; country?: string | null; phone?: string | null; email?: string | null; websiteUrl?: string | null; instagramUrl?: string | null; mapsUrl?: string | null; menuUrl?: string | null; whatsappPhone?: string | null; assistantEnabled?: boolean; assistantName?: string | null; assistantRole?: string | null; assistantLocale?: string | null; assistantTone?: string | null; assistantFirstGreeting?: string | null; assistantDisclosure?: boolean; humanSupportPhone?: string | null; humanSupportWhatsapp?: string | null; humanSupportEmail?: string | null; specials: SpecialInput[]; faqs: FaqInput[]; assistantUpdates: AssistantUpdateInput[]; branches: Array<{ id: string; openingHours: OpeningHourInput[] }> };

const asDate = (value: string) => new Date(`${value}T00:00:00.000Z`);
const asDateString = (value: Date | null) => value ? value.toISOString().slice(0, 10) : null;

@Injectable()
export class RestaurantConfigurationService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  private owner(user: RequestUser) {
    if (user.scope !== "restaurant" || user.role !== "restaurant_owner" || !user.restaurantId) throw new ForbiddenException("Solo el dueño del restaurante puede editar la configuración");
    return user.restaurantId;
  }

  async getPersonalize(user: RequestUser) {
    const restaurantId = this.owner(user);
    const [customization, booking, specials, faqs, assistantUpdates, branches] = await Promise.all([
      this.prisma.restaurantCustomization.findUnique({ where: { restaurantId } }),
      this.prisma.onlineBookingSettings.findUnique({ where: { restaurantId }, select: { whatsappPhone: true } }),
      this.prisma.restaurantSpecial.findMany({ where: { restaurantId }, orderBy: [{ startsAt: "desc" }, { createdAt: "desc" }] }),
      this.prisma.restaurantFaq.findMany({ where: { restaurantId }, orderBy: [{ position: "asc" }, { createdAt: "asc" }] }),
      this.prisma.restaurantAssistantUpdate.findMany({ where: { restaurantId }, orderBy: [{ position: "asc" }, { createdAt: "asc" }] }),
      this.prisma.branch.findMany({ where: { restaurantId }, select: { id: true, name: true, openingHours: { select: { weekday: true, startTime: true, endTime: true, endsNextDay: true }, orderBy: [{ weekday: "asc" }, { startTime: "asc" }] } }, orderBy: { createdAt: "asc" } })
    ]);
    return { description: customization?.description || null, cuisineType: customization?.cuisineType || null, address: customization?.address || null, city: customization?.city || null, province: customization?.province || null, country: customization?.country || null, phone: customization?.phone || null, email: customization?.email || null, websiteUrl: customization?.websiteUrl || null, instagramUrl: customization?.instagramUrl || null, mapsUrl: customization?.mapsUrl || null, menuUrl: customization?.menuUrl || null, whatsappPhone: booking?.whatsappPhone || null, assistantEnabled: customization?.assistantEnabled ?? true, assistantName: customization?.assistantName || null, assistantRole: customization?.assistantRole || null, assistantLocale: customization?.assistantLocale || "es-AR", assistantTone: customization?.assistantTone || "calido_breve_profesional", assistantFirstGreeting: customization?.assistantFirstGreeting || null, assistantDisclosure: customization?.assistantDisclosure ?? true, humanSupportPhone: customization?.humanSupportPhone || null, humanSupportWhatsapp: customization?.humanSupportWhatsapp || null, humanSupportEmail: customization?.humanSupportEmail || null, specials: specials.map((special) => ({ ...special, price: special.price ? Number(special.price) : null, startsAt: special.startsAt.toISOString().slice(0, 10), endsAt: special.endsAt.toISOString().slice(0, 10) })), faqs, assistantUpdates: assistantUpdates.map((update) => ({ ...update, startsAt: asDateString(update.startsAt), endsAt: asDateString(update.endsAt) })), branches };
  }

  async savePersonalize(user: RequestUser, input: PersonalizeInput) {
    const restaurantId = this.owner(user);
    const currentBranches = await this.prisma.branch.findMany({ where: { restaurantId }, select: { id: true } });
    const configuredBranchIds = new Set(input.branches.map((branch) => branch.id));
    if (configuredBranchIds.size !== currentBranches.length || currentBranches.some((branch) => !configuredBranchIds.has(branch.id))) throw new BadRequestException("La configuraciÃ³n debe incluir todas las sucursales del restaurante");
    const [existingSpecials, existingFaqs, existingUpdates] = await Promise.all([this.prisma.restaurantSpecial.findMany({ where: { restaurantId }, select: { id: true } }), this.prisma.restaurantFaq.findMany({ where: { restaurantId }, select: { id: true } }), this.prisma.restaurantAssistantUpdate.findMany({ where: { restaurantId }, select: { id: true } })]);
    const specialIds = new Set(existingSpecials.map((item) => item.id)); const faqIds = new Set(existingFaqs.map((item) => item.id)); const updateIds = new Set(existingUpdates.map((item) => item.id));
    if (input.specials.some((special) => special.id && !specialIds.has(special.id))) throw new ForbiddenException("Especial inválido");
    if (input.faqs.some((faq) => faq.id && !faqIds.has(faq.id))) throw new ForbiddenException("FAQ inválida");
    if (input.assistantUpdates.some((update) => update.id && !updateIds.has(update.id))) throw new ForbiddenException("Novedad inválida");
    await this.prisma.$transaction(async (tx) => {
      const customization = { description: input.description, cuisineType: input.cuisineType, address: input.address, city: input.city, province: input.province, country: input.country, phone: input.phone, email: input.email, websiteUrl: input.websiteUrl, instagramUrl: input.instagramUrl, mapsUrl: input.mapsUrl, menuUrl: input.menuUrl, assistantEnabled: input.assistantEnabled, assistantName: input.assistantName, assistantRole: input.assistantRole, assistantLocale: input.assistantLocale || "es-AR", assistantTone: input.assistantTone || "calido_breve_profesional", assistantFirstGreeting: input.assistantFirstGreeting, assistantDisclosure: input.assistantDisclosure, humanSupportPhone: input.humanSupportPhone, humanSupportWhatsapp: input.humanSupportWhatsapp, humanSupportEmail: input.humanSupportEmail };
      await tx.restaurantCustomization.upsert({ where: { restaurantId }, create: { restaurantId, ...customization }, update: { ...customization, configVersion: { increment: 1 } } });
      await tx.onlineBookingSettings.upsert({ where: { restaurantId }, create: { restaurantId, whatsappPhone: input.whatsappPhone }, update: { whatsappPhone: input.whatsappPhone } });
      await tx.branchOpeningHour.deleteMany({ where: { restaurantId } });
      const openingHours = input.branches.flatMap((branch) => branch.openingHours.map((hour) => ({ restaurantId, branchId: branch.id, ...hour })));
      if (openingHours.length) await tx.branchOpeningHour.createMany({ data: openingHours });
      await this.saveSpecials(tx, restaurantId, input.specials); await this.saveFaqs(tx, restaurantId, input.faqs); await this.saveAssistantUpdates(tx, restaurantId, input.assistantUpdates);
    });
    await this.audit.log({ action: "restaurant.customization.updated", targetType: "restaurant", targetId: restaurantId, restaurantId, restaurantUserId: user.sub });
    return this.getPersonalize(user);
  }

  private async saveSpecials(tx: Prisma.TransactionClient, restaurantId: string, specials: SpecialInput[]) { const retained = specials.flatMap((special) => special.id ? [special.id] : []); await tx.restaurantSpecial.deleteMany({ where: { restaurantId, ...(retained.length ? { id: { notIn: retained } } : {}) } }); for (const special of specials) { const data = { title: special.title, description: special.description || null, price: special.price === null || special.price === undefined ? null : new Prisma.Decimal(special.price), imageUrl: special.imageUrl || null, externalUrl: special.externalUrl || null, isActive: special.isActive, startsAt: asDate(special.startsAt), endsAt: new Date(`${special.endsAt}T23:59:59.999Z`) }; if (special.id) await tx.restaurantSpecial.update({ where: { id: special.id }, data }); else await tx.restaurantSpecial.create({ data: { restaurantId, ...data } }); } }
  private async saveFaqs(tx: Prisma.TransactionClient, restaurantId: string, faqs: FaqInput[]) { const retained = faqs.flatMap((faq) => faq.id ? [faq.id] : []); await tx.restaurantFaq.deleteMany({ where: { restaurantId, ...(retained.length ? { id: { notIn: retained } } : {}) } }); for (const [position, faq] of faqs.entries()) { const data = { topic: faq.topic, question: faq.question, answer: faq.answer, isActive: faq.isActive, position }; if (faq.id) await tx.restaurantFaq.update({ where: { id: faq.id }, data }); else await tx.restaurantFaq.create({ data: { restaurantId, ...data } }); } }
  private async saveAssistantUpdates(tx: Prisma.TransactionClient, restaurantId: string, updates: AssistantUpdateInput[]) { const retained = updates.flatMap((update) => update.id ? [update.id] : []); await tx.restaurantAssistantUpdate.deleteMany({ where: { restaurantId, ...(retained.length ? { id: { notIn: retained } } : {}) } }); for (const [position, update] of updates.entries()) { const data = { title: update.title, category: update.category, content: update.content, isActive: update.isActive, validityType: update.validityType, startsAt: update.validityType === "indefinite" ? null : asDate(update.startsAt as string), endsAt: update.validityType === "indefinite" ? null : new Date(`${update.endsAt}T23:59:59.999Z`), position }; if (update.id) await tx.restaurantAssistantUpdate.update({ where: { id: update.id }, data }); else await tx.restaurantAssistantUpdate.create({ data: { restaurantId, ...data } }); } }
}
