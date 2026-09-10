import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { DocumentCategory, DocumentOrigin, DocumentStatus } from "@prisma/client";
import { randomUUID } from "crypto";
import { AuditService } from "../audit/audit.service";
import type { RequestUser } from "../../common/auth/request-user";
import { hashOpaqueToken } from "../../common/security/token-hash";
import { R2StorageService } from "../deposits/r2-storage.service";
import { PrismaService } from "../prisma/prisma.service";

const documentMimeTypes = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "text/csv", "text/plain"]);
const proofMimeTypes = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);
const documentRoles = new Set(["restaurant_owner", "restaurant_manager"]);
const normalizePhone = (value?: string | null) => (value || "").replace(/\D/g, "");
const safeName = (value: string) => value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120) || "document";

type UploadInput = { fileName: string; mimeType: string; size: number; category?: DocumentCategory; suggestedCategory?: DocumentCategory; suggestionConfidence?: number; contactName?: string; contactPhone?: string; externalMessageId?: string; caption?: string; branchId?: string };

@Injectable()
export class DocumentsService {
  constructor(private readonly prisma: PrismaService, private readonly storage: R2StorageService, private readonly audit: AuditService) {}

  private restaurantId(user: RequestUser) {
    if (user.scope !== "restaurant" || !user.restaurantId) throw new ForbiddenException("Restaurant context required");
    return user.restaurantId;
  }
  private assertManagers(user: RequestUser) {
    if (!documentRoles.has(String(user.role))) throw new ForbiddenException("Document management role required");
  }
  private validate(input: UploadInput, proof = false) {
    const allowed = proof ? proofMimeTypes : documentMimeTypes;
    const limit = proof ? 10 * 1024 * 1024 : 25 * 1024 * 1024;
    if (!allowed.has(input.mimeType) || !Number.isInteger(input.size) || input.size <= 0 || input.size > limit) throw new BadRequestException("Unsupported document file");
  }
  private async externalRestaurant(apiKey: string) {
    if (!apiKey) throw new ForbiddenException("Invalid API key");
    const token = await this.prisma.integrationToken.findFirst({ where: { tokenHash: hashOpaqueToken(apiKey), isActive: true }, select: { restaurantId: true } });
    if (!token) throw new ForbiddenException("Invalid API key");
    return token.restaurantId;
  }
  private async prepare(restaurantId: string, input: UploadInput, origin: DocumentOrigin, createdByUserId?: string) {
    const phone = normalizePhone(input.contactPhone);
    const request = phone ? await this.prisma.depositProofRequest.findFirst({ where: { restaurantId, phone, status: "awaiting_proof", expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } }) : null;
    const proof = Boolean(request);
    this.validate(input, proof);
    if (input.externalMessageId) {
      const existing = await this.prisma.document.findFirst({ where: { restaurantId, externalMessageId: input.externalMessageId } });
      if (existing) return { document: existing, uploadUrl: await this.storage.uploadUrl(existing.objectKey, existing.mimeType), duplicate: true };
    }
    const category = proof ? "deposit_proof" : input.category || "other";
    const objectKey = `documents/${restaurantId}/${category}/${randomUUID()}-${safeName(input.fileName)}`;
    const document = await this.prisma.document.create({ data: { restaurantId, branchId: input.branchId || null, category, suggestedCategory: proof ? null : input.suggestedCategory || null, suggestionConfidence: proof ? null : input.suggestionConfidence || null, origin, status: proof ? "active" : "inbox", objectKey, originalName: input.fileName.slice(0, 255), mimeType: input.mimeType, size: input.size, contactName: input.contactName?.slice(0, 160) || null, contactPhone: phone || null, externalMessageId: input.externalMessageId?.slice(0, 255) || null, caption: input.caption?.slice(0, 2000) || null, depositProofRequestId: request?.id || null, createdByUserId: createdByUserId || null } });
    return { document, uploadUrl: await this.storage.uploadUrl(objectKey, input.mimeType), duplicate: false };
  }

  async uploadUrl(user: RequestUser, input: UploadInput) {
    this.assertManagers(user); this.validate(input);
    return this.prepare(this.restaurantId(user), input, "manual", user.sub);
  }
  async confirm(user: RequestUser, documentId: string) {
    this.assertManagers(user);
    return this.confirmStored(this.restaurantId(user), documentId);
  }
  async externalUploadUrl(apiKey: string, input: UploadInput) { return this.prepare(await this.externalRestaurant(apiKey), input, "n8n"); }
  async externalConfirm(apiKey: string, documentId: string) { return this.confirmStored(await this.externalRestaurant(apiKey), documentId); }
  private async confirmStored(restaurantId: string, documentId: string) {
    const document = await this.prisma.document.findFirst({ where: { id: documentId, restaurantId }, include: { depositProof: true } });
    if (!document) throw new NotFoundException("Document not found");
    if (document.depositProofRequestId && !document.depositProof) {
      await this.prisma.$transaction([
        this.prisma.depositProof.create({ data: { restaurantId, requestId: document.depositProofRequestId, documentId: document.id, objectKey: document.objectKey, originalName: document.originalName, mimeType: document.mimeType, size: document.size, messageId: document.externalMessageId, caption: document.caption } }),
        this.prisma.depositProofRequest.update({ where: { id: document.depositProofRequestId }, data: { status: "received" } })
      ]);
    }
    await this.audit.log({ action: "document.imported", targetType: "document", targetId: document.id, restaurantId, metadata: { origin: document.origin, category: document.category, matchedDeposit: Boolean(document.depositProofRequestId) } });
    return { documentId: document.id, matchedDeposit: Boolean(document.depositProofRequestId) };
  }
  async list(user: RequestUser, input: { category?: DocumentCategory; status?: DocumentStatus; search?: string; branchId?: string }) {
    this.assertManagers(user); const restaurantId = this.restaurantId(user);
    return this.prisma.document.findMany({ where: { restaurantId, ...(input.category ? { category: input.category } : {}), ...(input.status ? { status: input.status } : {}), ...(input.branchId ? { branchId: input.branchId } : {}), ...(input.search ? { OR: [{ originalName: { contains: input.search, mode: "insensitive" } }, { contactName: { contains: input.search, mode: "insensitive" } }, { contactPhone: { contains: input.search } }] } : {}) }, include: { depositProof: { include: { request: { include: { deposit: { include: { reservation: true } } } } } } }, orderBy: { createdAt: "desc" } });
  }
  async download(user: RequestUser, id: string) { this.assertManagers(user); const doc = await this.prisma.document.findFirst({ where: { id, restaurantId: this.restaurantId(user) } }); if (!doc) throw new NotFoundException("Document not found"); await this.audit.log({ action: "document.downloaded", targetType: "document", targetId: id, restaurantId: doc.restaurantId, restaurantUserId: user.sub }); return { url: await this.storage.downloadUrl(doc.objectKey, doc.originalName), mimeType: doc.mimeType }; }
  async classify(user: RequestUser, id: string, input: { category: DocumentCategory; branchId?: string | null }) { this.assertManagers(user); const doc = await this.prisma.document.findFirst({ where: { id, restaurantId: this.restaurantId(user) } }); if (!doc) throw new NotFoundException("Document not found"); const updated = await this.prisma.document.update({ where: { id }, data: { category: input.category, branchId: input.branchId || null, status: "active" } }); await this.audit.log({ action: "document.classified", targetType: "document", targetId: id, restaurantId: doc.restaurantId, restaurantUserId: user.sub, metadata: { category: input.category } }); return updated; }
  async archive(user: RequestUser, id: string) { this.assertManagers(user); const doc = await this.prisma.document.findFirst({ where: { id, restaurantId: this.restaurantId(user) } }); if (!doc) throw new NotFoundException("Document not found"); const updated = await this.prisma.document.update({ where: { id }, data: { status: "archived", archivedAt: new Date(), archivedByUserId: user.sub } }); await this.audit.log({ action: "document.archived", targetType: "document", targetId: id, restaurantId: doc.restaurantId, restaurantUserId: user.sub }); return updated; }
}
