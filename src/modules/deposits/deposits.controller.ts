import { Body, Controller, Get, Headers, Param, Post, Put, Query } from "@nestjs/common";
import { z } from "zod";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import { Public } from "../../common/auth/public.decorator";
import type { RequestUser } from "../../common/auth/request-user";
import { DepositsService } from "./deposits.service";
import { PrismaService } from "../prisma/prisma.service";
import { hashOpaqueToken } from "../../common/security/token-hash";
import { ForbiddenException } from "@nestjs/common";

const depositSchema = z.object({ requiredAmount: z.number().positive(), notes: z.string().max(2000).optional(), currency: z.string().length(3).optional() });
const entrySchema = z.object({ type: z.enum(["payment", "refund", "adjustment"]), amount: z.number().positive(), paidAt: z.string().min(10), paymentMethod: z.string().min(1).max(80), reference: z.string().max(160).optional(), notes: z.string().max(2000).optional(), proofIds: z.array(z.string()).max(20).optional() });
const uploadSchema = z.object({ fileName: z.string().min(1).max(255), mimeType: z.enum(["application/pdf", "image/jpeg", "image/png", "image/webp"]), size: z.number().int().positive().max(10 * 1024 * 1024) });
const confirmSchema = uploadSchema.extend({ objectKey: z.string().min(1), messageId: z.string().max(255).optional(), caption: z.string().max(2000).optional() });
const approveSchema = z.object({ amount: z.number().positive(), paidAt: z.string().min(10), paymentMethod: z.string().min(1).max(80), reference: z.string().max(160).optional(), notes: z.string().max(2000).optional() });
const rejectSchema = z.object({ reason: z.string().trim().min(2).max(2000) });

@Controller()
export class DepositsController {
  constructor(private readonly service: DepositsService, private readonly prisma: PrismaService) {}
  @Get("restaurant/deposits") list(@CurrentUser() user: RequestUser, @Query("branchId") branchId?: string, @Query("status") status?: "pending" | "partial" | "complete") { return this.service.list(user, { branchId, status }); }
  @Get("restaurant/deposits/proofs/pending") pending(@CurrentUser() user: RequestUser) { return this.service.pendingProofs(user); }
  @Put("restaurant/reservations/:reservationId/deposit") upsert(@CurrentUser() user: RequestUser, @Param("reservationId") reservationId: string, @Body() body: unknown) { return this.service.upsert(user, reservationId, depositSchema.parse(body)); }
  @Post("restaurant/deposits/:depositId/entries") entry(@CurrentUser() user: RequestUser, @Param("depositId") depositId: string, @Body() body: unknown) { return this.service.addEntry(user, depositId, entrySchema.parse(body)); }
  @Post("restaurant/deposits/:depositId/proof-requests") request(@CurrentUser() user: RequestUser, @Param("depositId") depositId: string, @Body() body: { expiresHours?: number }) { return this.service.requestProof(user, depositId, body.expiresHours); }
  @Get("restaurant/deposits/proofs/:proofId/download") async download(@CurrentUser() user: RequestUser, @Param("proofId") proofId: string) { return this.service.download(user, proofId); }
  @Post("restaurant/deposits/proofs/:proofId/approve") approve(@CurrentUser() user: RequestUser, @Param("proofId") proofId: string, @Body() body: unknown) { return this.service.approveProof(user, proofId, approveSchema.parse(body)); }
  @Post("restaurant/deposits/proofs/:proofId/reject") reject(@CurrentUser() user: RequestUser, @Param("proofId") proofId: string, @Body() body: unknown) { return this.service.rejectProof(user, proofId, rejectSchema.parse(body).reason); }

  @Public() @Get("external/deposits/proof-request") async open(@Headers("x-api-key") apiKey: string, @Query("phone") phone: string) { const restaurantId = await this.resolveRestaurant(apiKey); const request = await this.service.externalOpenRequest(restaurantId, phone); return { active: Boolean(request), requestId: request?.id || null }; }
  @Public() @Post("external/deposits/proof-requests/:requestId/upload-url") async upload(@Headers("x-api-key") apiKey: string, @Param("requestId") requestId: string, @Body() body: unknown) { return this.service.externalUploadUrl(await this.resolveRestaurant(apiKey), requestId, uploadSchema.parse(body)); }
  @Public() @Post("external/deposits/proof-requests/:requestId/confirm-upload") async confirm(@Headers("x-api-key") apiKey: string, @Param("requestId") requestId: string, @Body() body: unknown) { return this.service.externalConfirmUpload(await this.resolveRestaurant(apiKey), requestId, confirmSchema.parse(body)); }
  @Public() @Get("external/reservations/reminder-eligibility") async reminder(@Headers("x-api-key") apiKey: string, @Query("reservationCode") reservationCode: string) { return this.service.reminderEligibility(await this.resolveRestaurant(apiKey), reservationCode); }
  private async resolveRestaurant(apiKey: string) { const token = await this.prisma.integrationToken.findFirst({ where: { tokenHash: hashOpaqueToken(apiKey), isActive: true }, select: { restaurantId: true } }); if (!token) throw new ForbiddenException("Invalid API key"); return token.restaurantId; }
}
