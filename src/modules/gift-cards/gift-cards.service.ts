import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, GiftCardProductType, GiftCardStatus } from "@prisma/client";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import QRCode from "qrcode";
import PDFDocument from "pdfkit";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../prisma/prisma.service";
import type { RequestUser } from "../../common/auth/request-user";
import { createOpaqueToken, hashOpaqueToken } from "../../common/security/token-hash";
import { verifyPassword } from "../../common/security/password";

type ProductInput = { name: string; type: GiftCardProductType; description: string; price?: number | null; minAmount?: number | null; maxAmount?: number | null; partySize?: number | null; currency?: string; validityDays: number; excludedDates?: string[]; restrictions?: Record<string, unknown> | null; paymentAlias?: string | null; paymentCbu?: string | null; paymentHolder?: string | null; isActive: boolean };
type OrderInput = { productId?: string; type: GiftCardProductType; purchaserName: string; purchaserPhone: string; recipientName?: string | null; message?: string | null; partySize?: number | null; amount?: number; currency?: string };

const money = (value: Prisma.Decimal | number) => Number(value);
const dateOnly = (date: Date) => date.toISOString().slice(0, 10);

@Injectable()
export class GiftCardsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  private owner(user: RequestUser) {
    if (user.scope !== "restaurant" || user.role !== "restaurant_owner" || !user.restaurantId) throw new ForbiddenException("Solo el dueño puede administrar Gift Cards");
    return user.restaurantId;
  }

  private async externalRestaurant(apiKey: string) {
    if (!apiKey) throw new ForbiddenException("Invalid API key");
    const direct = await this.prisma.integrationToken.findFirst({ where: { tokenHash: hashOpaqueToken(apiKey), isActive: true } });
    if (direct) return direct.restaurantId;
    const candidates = await this.prisma.integrationToken.findMany({ where: { isActive: true } });
    const legacy = candidates.find((candidate) => verifyPassword(apiKey, candidate.tokenHash));
    if (!legacy) throw new ForbiddenException("Invalid API key");
    return legacy.restaurantId;
  }

  private productView(product: any) {
    return { id: product.id, name: product.name, type: product.type, description: product.description, price: product.price == null ? null : money(product.price), minAmount: product.minAmount == null ? null : money(product.minAmount), maxAmount: product.maxAmount == null ? null : money(product.maxAmount), partySize: product.partySize, currency: product.currency, validityDays: product.validityDays, excludedDates: product.excludedDates, restrictions: product.restrictions, paymentAlias: product.paymentAlias, paymentCbu: product.paymentCbu, paymentHolder: product.paymentHolder, isActive: product.isActive, createdAt: product.createdAt, updatedAt: product.updatedAt };
  }

  async listProducts(user: RequestUser) { const restaurantId = this.owner(user); return (await this.prisma.giftCardProduct.findMany({ where: { restaurantId }, orderBy: [{ isActive: "desc" }, { createdAt: "desc" }] })).map((item) => this.productView(item)); }

  async listExternalProducts(apiKey: string) { const restaurantId = await this.externalRestaurant(apiKey); return { products: (await this.prisma.giftCardProduct.findMany({ where: { restaurantId, isActive: true }, orderBy: { createdAt: "asc" } })).map((item) => this.productView(item)) }; }

  async saveProduct(user: RequestUser, productId: string | undefined, input: ProductInput) {
    const restaurantId = this.owner(user);
    this.validateProduct(input);
    const data = { name: input.name.trim(), type: input.type, description: input.description.trim(), price: input.price == null ? null : new Prisma.Decimal(input.price), minAmount: input.minAmount == null ? null : new Prisma.Decimal(input.minAmount), maxAmount: input.maxAmount == null ? null : new Prisma.Decimal(input.maxAmount), partySize: input.partySize ?? null, currency: input.currency || "ARS", validityDays: input.validityDays, excludedDates: input.excludedDates || [], restrictions: input.restrictions as Prisma.InputJsonValue | undefined, paymentAlias: input.paymentAlias?.trim() || null, paymentCbu: input.paymentCbu?.trim() || null, paymentHolder: input.paymentHolder?.trim() || null, isActive: input.isActive };
    const product = productId ? await this.prisma.giftCardProduct.update({ where: { id: productId, restaurantId }, data }) : await this.prisma.giftCardProduct.create({ data: { restaurantId, ...data } });
    await this.audit.log({ action: productId ? "gift_card.product.updated" : "gift_card.product.created", targetType: "gift_card_product", targetId: product.id, restaurantId, restaurantUserId: user.sub });
    return this.productView(product);
  }

  async deleteProduct(user: RequestUser, productId: string) {
    const restaurantId = this.owner(user);
    await this.prisma.giftCardProduct.update({ where: { id: productId, restaurantId }, data: { isActive: false } });
    return { success: true };
  }

  private validateProduct(input: ProductInput) {
    if (input.name.trim().length < 2 || input.description.trim().length < 2) throw new ConflictException("El producto requiere nombre y descripción");
    if (!Number.isInteger(input.validityDays) || input.validityDays < 1 || input.validityDays > 3650) throw new ConflictException("La vigencia debe estar entre 1 y 3650 días");
    if (input.type === "FIXED_MENU" && (!input.price || input.price <= 0 || !input.partySize || input.partySize < 1)) throw new ConflictException("Un menú requiere precio y cantidad de personas");
    if (input.type === "OPEN_AMOUNT" && (input.minAmount == null || input.maxAmount == null || input.minAmount <= 0 || input.maxAmount < input.minAmount)) throw new ConflictException("El importe libre requiere mínimo y máximo válidos");
    if ([...(input.excludedDates || [])].some((date) => !/^\d{4}-\d{2}-\d{2}$/.test(date))) throw new ConflictException("Hay una fecha excluida inválida");
  }

  async listOrders(user: RequestUser, query?: { status?: string; search?: string }) {
    const restaurantId = this.owner(user);
    const search = query?.search?.trim();
    const orders = await this.prisma.giftCardOrder.findMany({ where: { restaurantId, ...(query?.status ? { status: query.status as any } : {}), ...(search ? { OR: [{ id: search }, { purchaserName: { contains: search, mode: "insensitive" } }, { purchaserPhone: { contains: search } }, { recipientName: { contains: search, mode: "insensitive" } }, { giftCard: { displayCode: search } }] } : {}) }, include: { product: true, giftCard: true }, orderBy: { createdAt: "desc" }, take: 500 });
    return orders.map((order) => ({ id: order.id, purchaserName: order.purchaserName, purchaserPhone: order.purchaserPhone, recipientName: order.recipientName, message: order.message, type: order.type, partySize: order.partySize, amount: money(order.amount), currency: order.currency, paymentMethod: order.paymentMethod, paymentStatus: order.paymentStatus, status: order.status, paymentReference: order.paymentReference, paymentConfirmedAt: order.paymentConfirmedAt, createdAt: order.createdAt, product: order.product ? this.productView(order.product) : null, giftCard: order.giftCard ? this.giftCardView(order.giftCard) : null }));
  }

  private giftCardView(card: any) { const asset = (value: string | null) => value ? (value.startsWith("http") ? value : `${process.env.PUBLIC_API_ORIGIN || "http://localhost:4000"}${value}`) : null; return { id: card.id, code: card.displayCode, status: card.status, originalAmount: money(card.originalAmount), currency: card.currency, validFrom: dateOnly(card.validFrom), validUntil: dateOnly(card.validUntil), imageUrl: asset(card.imageUrl), pdfUrl: asset(card.pdfUrl), qrUrl: asset(card.qrUrl), issuedAt: card.issuedAt, redeemedAt: card.redeemedAt }; }

  async createExternal(apiKey: string, input: OrderInput, idempotencyKey?: string) {
    const restaurantId = await this.externalRestaurant(apiKey);
    if (idempotencyKey) { const existing = await this.prisma.externalApiRequest.findFirst({ where: { restaurantId, action: "gift_card.create_order", idempotencyKey } }); if (existing?.responseData) return existing.responseData; }
    const product = input.productId ? await this.prisma.giftCardProduct.findFirst({ where: { id: input.productId, restaurantId, isActive: true } }) : null;
    if (input.type === "FIXED_MENU" && !product) throw new NotFoundException("Gift Card product not found");
    const amount = input.type === "FIXED_MENU" ? Number(product!.price) : Number(input.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw new ConflictException("Invalid Gift Card amount");
    if (input.type === "OPEN_AMOUNT" && product && ((product.minAmount && amount < Number(product.minAmount)) || (product.maxAmount && amount > Number(product.maxAmount)))) throw new ConflictException("Amount is outside product limits");
    if (input.type === "FIXED_MENU" && input.partySize !== undefined && input.partySize !== product!.partySize) throw new ConflictException("Party size does not match product");
    const order = await this.prisma.giftCardOrder.create({ data: { restaurantId, productId: product?.id, type: input.type, purchaserName: input.purchaserName.trim(), purchaserPhone: input.purchaserPhone.trim(), recipientName: input.recipientName?.trim() || null, message: input.message?.trim() || null, partySize: input.partySize ?? product?.partySize ?? null, amount: new Prisma.Decimal(amount), currency: input.currency || product?.currency || "ARS" } });
    const response = { order: { id: order.id, status: order.status, paymentMethod: order.paymentMethod, amount, currency: order.currency, paymentInstructions: { alias: product?.paymentAlias || process.env.GIFT_CARD_TRANSFER_ALIAS || "Consultar al restaurante", cbu: product?.paymentCbu || process.env.GIFT_CARD_TRANSFER_CBU || null, holder: product?.paymentHolder || process.env.GIFT_CARD_TRANSFER_HOLDER || null } } };
    if (idempotencyKey) await this.prisma.externalApiRequest.create({ data: { restaurantId, integrationTokenId: (await this.prisma.integrationToken.findFirstOrThrow({ where: { restaurantId, isActive: true }, select: { id: true } })).id, action: "gift_card.create_order", idempotencyKey, requestHash: hashOpaqueToken(JSON.stringify(input)), status: "success", responseData: response } });
    return response;
  }

  async getExternal(apiKey: string, orderId: string) { const restaurantId = await this.externalRestaurant(apiKey); const order = await this.prisma.giftCardOrder.findFirst({ where: { id: orderId, restaurantId }, include: { giftCard: true } }); if (!order) throw new NotFoundException("Gift Card order not found"); return { order: { id: order.id, status: order.status, paymentStatus: order.paymentStatus, amount: money(order.amount), currency: order.currency, giftCard: order.giftCard ? this.giftCardView(order.giftCard) : null } }; }

  async confirmPayment(user: RequestUser, orderId: string, approved: boolean, reference?: string) {
    const restaurantId = this.owner(user);
    const order = await this.prisma.giftCardOrder.findFirst({ where: { id: orderId, restaurantId }, include: { product: true, giftCard: true } });
    if (!order) throw new NotFoundException("Gift Card order not found");
    if (order.paymentStatus === "CONFIRMED" && order.giftCard) return { order: order.id, giftCard: this.giftCardView(order.giftCard) };
    if (!approved) { const rejected = await this.prisma.giftCardOrder.update({ where: { id: order.id }, data: { paymentStatus: "REJECTED", status: "CANCELLED", paymentReference: reference || null } }); await this.audit.log({ action: "gift_card.payment.rejected", targetType: "gift_card_order", targetId: order.id, restaurantId, restaurantUserId: user.sub }); return { order: rejected.id, status: rejected.status }; }
    const token = createOpaqueToken();
    const displayCode = `GC-${randomBytes(3).toString("hex").toUpperCase().match(/.{1,2}/g)!.join("-")}`;
    const validFrom = new Date(); const validityDays = order.product?.validityDays || 180; const validUntil = new Date(validFrom); validUntil.setUTCDate(validUntil.getUTCDate() + validityDays);
    const validationUrl = `${process.env.PUBLIC_API_URL || "http://localhost:4000/v1"}/public/gift-cards/validate/${token}`;
    const assets = await this.generateAssets(order, displayCode, validUntil, validationUrl);
    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.giftCardOrder.updateMany({ where: { id: order.id, paymentStatus: "PENDING", giftCard: null }, data: { paymentStatus: "CONFIRMED", status: "PAID", paymentReference: reference || null, paymentConfirmedAt: new Date(), paymentConfirmedBy: user.sub } });
      if (updated.count !== 1) { const existing = await tx.giftCard.findUnique({ where: { orderId: order.id } }); if (existing) return existing; throw new ConflictException("Order payment state changed"); }
      return tx.giftCard.create({ data: { restaurantId, orderId: order.id, displayCode, tokenHash: hashOpaqueToken(token), originalAmount: order.amount, currency: order.currency, validFrom, validUntil, imageUrl: assets.imageUrl, pdfUrl: assets.pdfUrl, qrUrl: assets.qrUrl } });
    });
    await this.audit.log({ action: "gift_card.issued", targetType: "gift_card", targetId: result.id, restaurantId, restaurantUserId: user.sub, metadata: { orderId: order.id } });
    return { order: order.id, giftCard: this.giftCardView(result) };
  }

  async redeem(user: RequestUser, input: { code?: string; token?: string; notes?: string; reservationId?: string }) {
    const restaurantId = this.owner(user); const hash = input.token ? hashOpaqueToken(input.token) : undefined; const card = await this.prisma.giftCard.findFirst({ where: { restaurantId, ...(hash ? { tokenHash: hash } : { displayCode: input.code }) }, include: { order: true } });
    if (!card) throw new NotFoundException("Gift Card not found");
    if (card.status !== "ACTIVE") throw new ConflictException("Gift Card is not active");
    if (card.validUntil < new Date()) { await this.prisma.giftCard.update({ where: { id: card.id }, data: { status: "EXPIRED" } }); throw new ConflictException("Gift Card expired"); }
    const redeemed = await this.prisma.$transaction(async (tx) => { const locked = await tx.giftCard.updateMany({ where: { id: card.id, status: "ACTIVE" }, data: { status: "REDEEMED", redeemedAt: new Date() } }); if (locked.count !== 1) throw new ConflictException("Gift Card already redeemed"); await tx.giftCardRedemption.create({ data: { giftCardId: card.id, restaurantId, redeemedBy: user.sub, reservationId: input.reservationId, notes: input.notes } }); return tx.giftCard.findUniqueOrThrow({ where: { id: card.id } }); });
    await this.audit.log({ action: "gift_card.redeemed", targetType: "gift_card", targetId: card.id, restaurantId, restaurantUserId: user.sub, metadata: { reservationId: input.reservationId || null } });
    return this.giftCardView(redeemed);
  }

  async validatePublicToken(token: string) { const card = await this.prisma.giftCard.findFirst({ where: { tokenHash: hashOpaqueToken(token) }, include: { order: { include: { product: true } } } }); if (!card) throw new NotFoundException("Gift Card not found"); const status = card.status === "ACTIVE" && card.validUntil < new Date() ? "EXPIRED" : card.status; return { code: card.displayCode, status, validUntil: dateOnly(card.validUntil), product: card.order.product?.name || null, partySize: card.order.partySize }; }

  private async generateAssets(order: any, code: string, validUntil: Date, validationUrl: string) {
    const directory = join(process.cwd(), "uploads", "gift-cards", order.restaurantId, order.id); await mkdir(directory, { recursive: true });
    const qrData = await QRCode.toDataURL(validationUrl, { errorCorrectionLevel: "H", margin: 1, width: 320 }); const qrBuffer = Buffer.from(qrData.split(",")[1], "base64");
    const qrFile = `qr-${code}.png`; await writeFile(join(directory, qrFile), qrBuffer);
    const imageFile = `gift-card-${code}.svg`; const image = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200" viewBox="0 0 900 1200"><rect width="900" height="1200" rx="42" fill="#1F1F21"/><rect x="35" y="35" width="830" height="1130" rx="30" fill="#FFF8F2"/><text x="450" y="150" text-anchor="middle" font-family="Arial" font-size="34" font-weight="700" fill="#F4511E">FOODIE</text><text x="450" y="260" text-anchor="middle" font-family="Arial" font-size="62" font-weight="700" fill="#1F1F21">GIFT CARD</text><text x="450" y="370" text-anchor="middle" font-family="Arial" font-size="28" fill="#555">Orden ${order.id}</text><text x="450" y="500" text-anchor="middle" font-family="Arial" font-size="48" font-weight="700" fill="#1F1F21">${code}</text><image href="data:image/png;base64,${qrBuffer.toString("base64")}" x="290" y="580" width="320" height="320"/><text x="450" y="1010" text-anchor="middle" font-family="Arial" font-size="28" fill="#555">Válida hasta ${dateOnly(validUntil)}</text><text x="450" y="1080" text-anchor="middle" font-family="Arial" font-size="22" fill="#777">Sujeta a condiciones y restricciones</text></svg>`; await writeFile(join(directory, imageFile), image, "utf8");
    const pdfFile = `gift-card-${code}.pdf`; await new Promise<void>((resolve, reject) => { const doc = new PDFDocument({ size: [450, 600], margin: 35 }); const chunks: Buffer[] = []; doc.on("data", (chunk: Buffer) => chunks.push(chunk)); doc.on("end", async () => { try { await writeFile(join(directory, pdfFile), Buffer.concat(chunks)); resolve(); } catch (error) { reject(error); } }); doc.on("error", reject); doc.rect(0, 0, 450, 600).fill("#FFF8F2"); doc.fillColor("#F4511E").fontSize(24).text("FOODIE", { align: "center" }); doc.moveDown(1).fillColor("#1F1F21").fontSize(34).text("GIFT CARD", { align: "center" }); doc.moveDown(1).fontSize(20).text(code, { align: "center" }); doc.moveDown(1).image(qrBuffer, 125, 210, { width: 200 }); doc.fontSize(14).text(`Válida hasta ${dateOnly(validUntil)}`, 35, 450, { align: "center", width: 380 }); doc.end(); });
    const base = `/uploads/gift-cards/${order.restaurantId}/${order.id}`; return { imageUrl: `${base}/${imageFile}`, pdfUrl: `${base}/${pdfFile}`, qrUrl: `${base}/${qrFile}` };
  }
}
