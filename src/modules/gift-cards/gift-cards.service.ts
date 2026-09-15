import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, GiftCardProductType, GiftCardStatus } from "@prisma/client";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import PDFDocument from "pdfkit";
import sharp from "sharp";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../prisma/prisma.service";
import type { RequestUser } from "../../common/auth/request-user";
import { hashOpaqueToken } from "../../common/security/token-hash";
import { verifyPassword } from "../../common/security/password";
import { createGiftCardCode } from "../../common/utils/code";

type ProductInput = { name: string; type: GiftCardProductType; description: string; price?: number | null; minAmount?: number | null; maxAmount?: number | null; partySize?: number | null; currency?: string; validityDays: number; excludedDates?: string[]; restrictions?: Record<string, unknown> | null; paymentAlias?: string | null; paymentCbu?: string | null; paymentHolder?: string | null; isActive: boolean };
type OrderInput = { productId?: string; type: GiftCardProductType; purchaserName: string; purchaserPhone: string; recipientName?: string | null; message?: string | null; partySize?: number | null; amount?: number; currency?: string };

const money = (value: Prisma.Decimal | number) => Number(value);
const dateOnly = (date: Date) => date.toISOString().slice(0, 10);
const displayDate = (date: Date) => new Intl.DateTimeFormat("es-AR", { timeZone: "UTC", day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
const displayAmount = (amount: Prisma.Decimal | number, currency: string) => new Intl.NumberFormat("es-AR", { style: "currency", currency: currency || "ARS", maximumFractionDigits: 0 }).format(money(amount));
const escapeXml = (value: string) => value.replace(/[<>&"']/g, (character) => ({ "<": "&lt;", ">": "&gt;", "&": "&quot;", '"': "&quot;", "'": "&apos;" })[character]!);

const GIFT_CARD_TEXT_ANGLE = -4;
const GIFT_CARD_RIGHT_BLOCK = { centerX: 785, centerY: 830, width: 300, height: 180, valueBaseline: 798, codeBaseline: 865 };
const GIFT_CARD_DATE_BLOCK = { centerX: 410, centerY: 978, width: 240, height: 80, dateBaseline: 978 };

type GiftCardValueLayout = { lines: string[]; fontSize: number; lineHeight: number };

function approximateTextWidth(value: string, fontSize: number) {
  return Array.from(value).reduce((width, character) => width + (character === " " ? fontSize * 0.3 : fontSize * 0.65), 0);
}

function splitMenuValue(value: string, maxWidth: number, fontSize: number) {
  const words = value.trim().replace(/\s+/g, " ").split(" ").filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && approximateTextWidth(candidate, fontSize) > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function ellipsizeLine(value: string, maxWidth: number, fontSize: number) {
  let result = value;
  while (result.length > 1 && approximateTextWidth(`${result}…`, fontSize) > maxWidth) result = result.slice(0, -1).trimEnd();
  return `${result}…`;
}

function fixedMenuValueLayout(value: string): GiftCardValueLayout {
  for (let fontSize = 30; fontSize >= 18; fontSize -= 1) {
    const lines = splitMenuValue(value, GIFT_CARD_RIGHT_BLOCK.width, fontSize);
    if (lines.length <= 2) return { lines, fontSize, lineHeight: Math.round(fontSize * 1.2) };
  }
  const fontSize = 18;
  const lines = splitMenuValue(value, GIFT_CARD_RIGHT_BLOCK.width, fontSize);
  return { lines: [lines[0] || "Gift Card", ellipsizeLine(lines.slice(1).join(" "), GIFT_CARD_RIGHT_BLOCK.width, fontSize)], fontSize, lineHeight: 22 };
}

function giftCardValueLayout(value: string, type: GiftCardProductType): GiftCardValueLayout {
  if (type === "OPEN_AMOUNT") return { lines: [value], fontSize: 36, lineHeight: 43 };
  return fixedMenuValueLayout(value);
}

async function rotateTextBlock(svg: string, width: number, height: number, centerX: number, centerY: number) {
  const horizontal = await sharp(Buffer.from(svg)).png().toBuffer();
  const rotated = await sharp(horizontal).rotate(GIFT_CARD_TEXT_ANGLE, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  const metadata = await sharp(rotated).metadata();
  return {
    input: rotated,
    left: Math.round(centerX - (metadata.width ?? width) / 2),
    top: Math.round(centerY - (metadata.height ?? height) / 2),
  };
}

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
    if (input.type === "OPEN_AMOUNT" && ((input.minAmount != null && input.minAmount <= 0) || (input.maxAmount != null && input.maxAmount <= 0) || (input.minAmount != null && input.maxAmount != null && input.maxAmount < input.minAmount))) throw new ConflictException("Los límites del importe libre no son válidos");
    if ([...(input.excludedDates || [])].some((date) => !/^\d{4}-\d{2}-\d{2}$/.test(date))) throw new ConflictException("Hay una fecha excluida inválida");
  }

  async listOrders(user: RequestUser, query?: { status?: string; search?: string }) {
    const restaurantId = this.owner(user);
    const search = query?.search?.trim();
    const orders = await this.prisma.giftCardOrder.findMany({ where: { restaurantId, ...(query?.status ? { status: query.status as any } : {}), ...(search ? { OR: [{ id: search }, { purchaserName: { contains: search, mode: "insensitive" } }, { purchaserPhone: { contains: search } }, { recipientName: { contains: search, mode: "insensitive" } }, { giftCard: { displayCode: search } }] } : {}) }, include: { product: true, giftCard: true }, orderBy: { createdAt: "desc" }, take: 500 });
    return orders.map((order) => ({ id: order.id, purchaserName: order.purchaserName, purchaserPhone: order.purchaserPhone, recipientName: order.recipientName, message: order.message, type: order.type, partySize: order.partySize, amount: money(order.amount), currency: order.currency, paymentMethod: order.paymentMethod, paymentStatus: order.paymentStatus, status: order.status, paymentReference: order.paymentReference, paymentConfirmedAt: order.paymentConfirmedAt, createdAt: order.createdAt, product: order.product ? this.productView(order.product) : null, giftCard: order.giftCard ? this.giftCardView(order.giftCard) : null }));
  }

  private giftCardView(card: any) { const asset = (value: string | null) => value ? (value.startsWith("http") ? value : `${process.env.PUBLIC_API_ORIGIN || "http://localhost:4000"}${value}`) : null; return { id: card.id, code: card.displayCode, status: card.status, originalAmount: money(card.originalAmount), currency: card.currency, validFrom: dateOnly(card.validFrom), validUntil: dateOnly(card.validUntil), imageUrl: asset(card.imageUrl), pdfUrl: asset(card.pdfUrl), issuedAt: card.issuedAt, redeemedAt: card.redeemedAt }; }

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
    const displayCode = createGiftCardCode();
    const validFrom = new Date(); const validityDays = order.product?.validityDays || 180; const validUntil = new Date(validFrom); validUntil.setUTCDate(validUntil.getUTCDate() + validityDays);
    const assets = await this.generateAssets(order, displayCode, validUntil);
    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.giftCardOrder.updateMany({ where: { id: order.id, paymentStatus: "PENDING", giftCard: null }, data: { paymentStatus: "CONFIRMED", status: "PAID", paymentReference: reference || null, paymentConfirmedAt: new Date(), paymentConfirmedBy: user.sub } });
      if (updated.count !== 1) { const existing = await tx.giftCard.findUnique({ where: { orderId: order.id } }); if (existing) return existing; throw new ConflictException("Order payment state changed"); }
      return tx.giftCard.create({ data: { restaurantId, orderId: order.id, displayCode, originalAmount: order.amount, currency: order.currency, validFrom, validUntil, imageUrl: assets.imageUrl, pdfUrl: assets.pdfUrl } });
    });
    await this.audit.log({ action: "gift_card.issued", targetType: "gift_card", targetId: result.id, restaurantId, restaurantUserId: user.sub, metadata: { orderId: order.id } });
    return { order: order.id, giftCard: this.giftCardView(result) };
  }

  async redeem(user: RequestUser, input: { code?: string; notes?: string; reservationId?: string }) {
    const restaurantId = this.owner(user); const code = input.code?.trim(); if (!code) throw new ConflictException("Gift Card code is required"); const card = await this.prisma.giftCard.findFirst({ where: { restaurantId, displayCode: code }, include: { order: true } });
    if (!card) throw new NotFoundException("Gift Card not found");
    if (card.status !== "ACTIVE") throw new ConflictException("Gift Card is not active");
    if (card.validUntil < new Date()) { await this.prisma.giftCard.update({ where: { id: card.id }, data: { status: "EXPIRED" } }); throw new ConflictException("Gift Card expired"); }
    const redeemed = await this.prisma.$transaction(async (tx) => { const locked = await tx.giftCard.updateMany({ where: { id: card.id, status: "ACTIVE" }, data: { status: "REDEEMED", redeemedAt: new Date() } }); if (locked.count !== 1) throw new ConflictException("Gift Card already redeemed"); await tx.giftCardRedemption.create({ data: { giftCardId: card.id, restaurantId, redeemedBy: user.sub, reservationId: input.reservationId, notes: input.notes } }); return tx.giftCard.findUniqueOrThrow({ where: { id: card.id } }); });
    await this.audit.log({ action: "gift_card.redeemed", targetType: "gift_card", targetId: card.id, restaurantId, restaurantUserId: user.sub, metadata: { reservationId: input.reservationId || null } });
    return this.giftCardView(redeemed);
  }

  private async generateAssets(order: any, code: string, validUntil: Date) {
    const directory = join(process.cwd(), "uploads", "gift-cards", order.restaurantId, order.id); await mkdir(directory, { recursive: true });
    const assetsDirectory = join(process.cwd(), "assets"); const templatePath = join(assetsDirectory, "gift-card-template.png");
    process.env.FONTCONFIG_FILE ??= join(assetsDirectory, "fonts", "fonts.conf"); process.env.XDG_CACHE_HOME ??= join(process.cwd(), "uploads", ".cache"); await mkdir(join(process.env.XDG_CACHE_HOME, "fontconfig"), { recursive: true });
    const value = order.type === "FIXED_MENU" ? order.product?.name || "Gift Card" : displayAmount(order.amount, order.currency);
    const date = displayDate(validUntil); const valueLayout = giftCardValueLayout(value, order.type);
    const valueBaselines = valueLayout.lines.length === 1
      ? [GIFT_CARD_RIGHT_BLOCK.valueBaseline]
      : valueLayout.lines.map((_, index) => GIFT_CARD_RIGHT_BLOCK.valueBaseline - (valueLayout.lineHeight / 2) + (index * valueLayout.lineHeight));
    const rightTop = GIFT_CARD_RIGHT_BLOCK.centerY - (GIFT_CARD_RIGHT_BLOCK.height / 2);
    const dateTop = GIFT_CARD_DATE_BLOCK.centerY - (GIFT_CARD_DATE_BLOCK.height / 2);
    const svgValueLines = valueLayout.lines.map((line, index) => `<text x="${GIFT_CARD_RIGHT_BLOCK.width / 2}" y="${valueBaselines[index] - rightTop}" text-anchor="middle" font-size="${valueLayout.fontSize}" font-weight="800" stroke="#282621" stroke-width="0.45">${escapeXml(line)}</text>`).join("");
    const rightBlockSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${GIFT_CARD_RIGHT_BLOCK.width}" height="${GIFT_CARD_RIGHT_BLOCK.height}"><style>text { font-family: Montserrat, sans-serif; fill: #282621; paint-order: stroke; }</style>${svgValueLines}<text x="${GIFT_CARD_RIGHT_BLOCK.width / 2}" y="${GIFT_CARD_RIGHT_BLOCK.codeBaseline - rightTop}" text-anchor="middle" font-size="22" font-weight="700" stroke="#282621" stroke-width="0.3" letter-spacing="1.8">${escapeXml(code)}</text></svg>`;
    const dateBlockSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${GIFT_CARD_DATE_BLOCK.width}" height="${GIFT_CARD_DATE_BLOCK.height}"><style>text { font-family: Montserrat, sans-serif; fill: #282621; paint-order: stroke; }</style><text x="${GIFT_CARD_DATE_BLOCK.width / 2}" y="${GIFT_CARD_DATE_BLOCK.dateBaseline - dateTop}" text-anchor="middle" font-size="20" font-weight="700" stroke="#282621" stroke-width="0.25">${escapeXml(date)}</text></svg>`;
    const [rightBlock, dateBlock] = await Promise.all([
      rotateTextBlock(rightBlockSvg, GIFT_CARD_RIGHT_BLOCK.width, GIFT_CARD_RIGHT_BLOCK.height, GIFT_CARD_RIGHT_BLOCK.centerX, GIFT_CARD_RIGHT_BLOCK.centerY),
      rotateTextBlock(dateBlockSvg, GIFT_CARD_DATE_BLOCK.width, GIFT_CARD_DATE_BLOCK.height, GIFT_CARD_DATE_BLOCK.centerX, GIFT_CARD_DATE_BLOCK.centerY),
    ]);
    const renderedImage = await sharp(templatePath).composite([rightBlock, dateBlock]).png().toBuffer();
    const imageFile = `gift-card-${code}.png`; const imagePath = join(directory, imageFile); await writeFile(imagePath, renderedImage);
    const pdfFile = `gift-card-${code}.pdf`; const pdfPath = join(directory, pdfFile);
    await new Promise<void>((resolve, reject) => { const doc = new PDFDocument({ size: [540, 720], margin: 0 }); const chunks: Buffer[] = []; doc.on("data", (chunk: Buffer) => chunks.push(chunk)); doc.on("end", async () => { try { await writeFile(pdfPath, Buffer.concat(chunks)); resolve(); } catch (error) { reject(error); } }); doc.on("error", reject); doc.image(renderedImage, 0, 0, { width: 540, height: 720 }); doc.end(); });
    const base = `/uploads/gift-cards/${order.restaurantId}/${order.id}`; return { imageUrl: `${base}/${imageFile}`, pdfUrl: `${base}/${pdfFile}` };
  }
}
