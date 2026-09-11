import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { DepositEntryType, DepositStatus, Prisma } from "@prisma/client";
import { randomUUID } from "crypto";
import { AuditService } from "../audit/audit.service";
import type { RequestUser } from "../../common/auth/request-user";
import { PrismaService } from "../prisma/prisma.service";
import { R2StorageService } from "./r2-storage.service";
import { normalizeReservationCode } from "../../common/utils/code";

const allowedMimeTypes = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const financialRoles = new Set(["restaurant_owner", "restaurant_manager", "cashier"]);
const numeric = (value: Prisma.Decimal | number) => Number(value);
const normalizedPhone = (value: string) => value.replace(/\D/g, "");

@Injectable()
export class DepositsService {
  constructor(private readonly prisma: PrismaService, private readonly storage: R2StorageService, private readonly audit: AuditService) {}

  private restaurantId(user: RequestUser) {
    if (user.scope !== "restaurant" || !user.restaurantId) throw new ForbiddenException("Restaurant context required");
    return user.restaurantId;
  }
  private assertFinancial(user: RequestUser) {
    if (!financialRoles.has(String(user.role))) throw new ForbiddenException("Financial role required");
  }
  private async depositForReservation(user: RequestUser, reservationId: string) {
    const restaurantId = this.restaurantId(user);
    const reservation = await this.prisma.reservation.findFirst({ where: { id: reservationId, restaurantId }, include: { deposit: true } });
    if (!reservation) throw new NotFoundException("Reservation not found");
    return reservation;
  }
  private status(required: number, paid: number): DepositStatus {
    if (paid <= 0) return "pending";
    return paid >= required ? "complete" : "partial";
  }
  private async refreshDeposit(depositId: string, tx: Prisma.TransactionClient) {
    const deposit = await tx.reservationDeposit.findUniqueOrThrow({ where: { id: depositId }, include: { entries: true } });
    const paid = deposit.entries.reduce((total, entry) => total + (entry.type === "refund" ? -numeric(entry.amount) : numeric(entry.amount)), 0);
    return tx.reservationDeposit.update({ where: { id: depositId }, data: { paidAmount: paid, status: this.status(numeric(deposit.requiredAmount), paid) } });
  }

  async upsert(user: RequestUser, reservationId: string, input: { requiredAmount: number; notes?: string; currency?: string }) {
    this.assertFinancial(user);
    if (!Number.isFinite(input.requiredAmount) || input.requiredAmount <= 0) throw new BadRequestException("Required amount must be positive");
    const reservation = await this.depositForReservation(user, reservationId);
    const deposit = await this.prisma.reservationDeposit.upsert({
      where: { reservationId },
      create: { restaurantId: reservation.restaurantId, branchId: reservation.branchId, reservationId, requiredAmount: input.requiredAmount, notes: input.notes?.trim() || null, currency: input.currency || "ARS" },
      update: { requiredAmount: input.requiredAmount, notes: input.notes?.trim() || null, currency: input.currency || "ARS" }
    });
    const updated = await this.prisma.$transaction((tx) => this.refreshDeposit(deposit.id, tx));
    await this.audit.log({ action: "deposit.upserted", targetType: "reservation_deposit", targetId: updated.id, restaurantId: reservation.restaurantId, restaurantUserId: user.sub, metadata: { reservationId, requiredAmount: input.requiredAmount } });
    return updated;
  }

  async addEntry(user: RequestUser, depositId: string, input: { type: DepositEntryType; amount: number; paidAt: string; paymentMethod: string; reference?: string; notes?: string; proofIds?: string[] }) {
    this.assertFinancial(user);
    if (!Number.isFinite(input.amount) || input.amount <= 0) throw new BadRequestException("Amount must be positive");
    const deposit = await this.prisma.reservationDeposit.findFirst({ where: { id: depositId, restaurantId: this.restaurantId(user) } });
    if (!deposit) throw new NotFoundException("Deposit not found");
    const result = await this.prisma.$transaction(async (tx) => {
      const entry = await tx.depositEntry.create({ data: { depositId, type: input.type, amount: input.amount, paidAt: new Date(input.paidAt), paymentMethod: input.paymentMethod.trim(), reference: input.reference?.trim() || null, notes: input.notes?.trim() || null, createdByUserId: user.sub } });
      if (input.proofIds?.length) await tx.depositProof.updateMany({ where: { id: { in: input.proofIds }, restaurantId: deposit.restaurantId, entryId: null }, data: { entryId: entry.id, reviewedAt: new Date(), reviewedByUserId: user.sub } });
      const updated = await this.refreshDeposit(depositId, tx);
      return { entry, deposit: updated };
    });
    await this.audit.log({ action: "deposit.entry_added", targetType: "reservation_deposit", targetId: depositId, restaurantId: deposit.restaurantId, restaurantUserId: user.sub, metadata: { entryId: result.entry.id, type: input.type, amount: input.amount } });
    return result;
  }

  async requestProof(user: RequestUser, depositId: string, expiresHours = 48) {
    this.assertFinancial(user);
    const deposit = await this.prisma.reservationDeposit.findFirst({ where: { id: depositId, restaurantId: this.restaurantId(user) }, include: { reservation: true } });
    if (!deposit) throw new NotFoundException("Deposit not found");
    await this.prisma.depositProofRequest.updateMany({ where: { depositId, status: "awaiting_proof" }, data: { status: "cancelled" } });
    return this.prisma.depositProofRequest.create({ data: { depositId, restaurantId: deposit.restaurantId, reservationId: deposit.reservationId, phone: normalizedPhone(deposit.reservation.phone), expiresAt: new Date(Date.now() + expiresHours * 3600_000), createdByUserId: user.sub } });
  }

  async list(user: RequestUser, input: { branchId?: string; status?: DepositStatus; pendingProofs?: boolean }) {
    this.assertFinancial(user);
    return this.prisma.reservationDeposit.findMany({ where: { restaurantId: this.restaurantId(user), ...(input.branchId ? { branchId: input.branchId } : {}), ...(input.status ? { status: input.status } : {}) }, include: { reservation: { select: { id: true, code: true, fullName: true, phone: true, serviceDate: true, serviceTime: true } }, entries: { orderBy: { paidAt: "desc" }, include: { proofs: true } }, proofRequests: { include: { proofs: true }, orderBy: { createdAt: "desc" } } }, orderBy: { updatedAt: "desc" } });
  }
  async pendingProofs(user: RequestUser) {
    this.assertFinancial(user);
    return this.prisma.depositProof.findMany({ where: { restaurantId: this.restaurantId(user), entryId: null }, include: { request: { include: { deposit: { include: { reservation: true } } } } }, orderBy: { receivedAt: "desc" } });
  }
  async download(user: RequestUser, proofId: string) {
    this.assertFinancial(user);
    const proof = await this.prisma.depositProof.findFirst({ where: { id: proofId, restaurantId: this.restaurantId(user) } });
    if (!proof) throw new NotFoundException("Proof not found");
    return { url: await this.storage.downloadUrl(proof.objectKey, proof.originalName) };
  }

  async externalOpenRequest(apiKeyRestaurantId: string, phone: string) {
    const now = new Date();
    return this.prisma.depositProofRequest.findFirst({ where: { restaurantId: apiKeyRestaurantId, phone: normalizedPhone(phone), status: "awaiting_proof", expiresAt: { gt: now } }, orderBy: { createdAt: "desc" } });
  }
  async externalUploadUrl(restaurantId: string, requestId: string, input: { fileName: string; mimeType: string; size: number }) {
    const request = await this.prisma.depositProofRequest.findFirst({ where: { id: requestId, restaurantId, status: "awaiting_proof", expiresAt: { gt: new Date() } } });
    if (!request) throw new NotFoundException("Active proof request not found");
    if (!allowedMimeTypes.has(input.mimeType) || !Number.isInteger(input.size) || input.size <= 0 || input.size > MAX_FILE_SIZE) throw new BadRequestException("Unsupported proof file");
    const safe = input.fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120) || "proof";
    const objectKey = `deposits/${restaurantId}/${request.reservationId}/${request.id}/${randomUUID()}-${safe}`;
    return { objectKey, uploadUrl: await this.storage.uploadUrl(objectKey, input.mimeType) };
  }
  async externalConfirmUpload(restaurantId: string, requestId: string, input: { objectKey: string; fileName: string; mimeType: string; size: number; messageId?: string; caption?: string }) {
    const request = await this.prisma.depositProofRequest.findFirst({ where: { id: requestId, restaurantId, status: "awaiting_proof", expiresAt: { gt: new Date() } } });
    if (!request || !input.objectKey.startsWith(`deposits/${restaurantId}/${request.reservationId}/${request.id}/`)) throw new NotFoundException("Active proof request not found");
    const proof = await this.prisma.depositProof.create({ data: { restaurantId, requestId, objectKey: input.objectKey, originalName: input.fileName.slice(0, 255), mimeType: input.mimeType, size: input.size, messageId: input.messageId?.slice(0, 255) || null, caption: input.caption?.slice(0, 2000) || null } });
    await this.prisma.depositProofRequest.update({ where: { id: requestId }, data: { status: "received" } });
    return { proofId: proof.id, status: "received_for_review" };
  }
  async reminderEligibility(restaurantId: string, reservationCode: string) {
    if (!reservationCode?.trim()) return { eligible: false };
    const reservation = await this.prisma.reservation.findFirst({ where: { codeNormalized: normalizeReservationCode(reservationCode), restaurantId }, include: { deposit: true } });
    return { eligible: Boolean(reservation && reservation.status === "confirmed" && (!reservation.deposit || reservation.deposit.status === "complete")) };
  }
}
