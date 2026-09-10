import { Body, Controller, Get, Headers, Param, Post, Put, Query } from "@nestjs/common";
import { z } from "zod";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import { Public } from "../../common/auth/public.decorator";
import type { RequestUser } from "../../common/auth/request-user";
import { DocumentsService } from "./documents.service";

const documentCategorySchema = z.enum(["deposit_proof", "cv", "price_list", "menu", "invoice", "contract", "supplier", "other"]);
const upload = z.object({ fileName: z.string().min(1).max(255), mimeType: z.string().min(3).max(180), size: z.number().int().positive().max(25 * 1024 * 1024), category: documentCategorySchema.optional(), suggestedCategory: documentCategorySchema.optional(), suggestionConfidence: z.number().min(0).max(1).optional(), contactName: z.string().max(160).optional(), contactPhone: z.string().max(60).optional(), externalMessageId: z.string().max(255).optional(), caption: z.string().max(2000).optional(), branchId: z.string().optional() });

@Controller()
export class DocumentsController {
  constructor(private readonly service: DocumentsService) {}
  @Get("restaurant/documents") list(@CurrentUser() user: RequestUser, @Query("category") category?: z.infer<typeof documentCategorySchema>, @Query("status") status?: "inbox" | "active" | "archived", @Query("search") search?: string, @Query("branchId") branchId?: string) { return this.service.list(user, { category, status, search, branchId }); }
  @Post("restaurant/documents/upload-url") upload(@CurrentUser() user: RequestUser, @Body() body: unknown) { return this.service.uploadUrl(user, upload.parse(body)); }
  @Post("restaurant/documents/:id/confirm") confirm(@CurrentUser() user: RequestUser, @Param("id") id: string) { return this.service.confirm(user, id); }
  @Get("restaurant/documents/:id/download") download(@CurrentUser() user: RequestUser, @Param("id") id: string) { return this.service.download(user, id); }
  @Put("restaurant/documents/:id/classification") classify(@CurrentUser() user: RequestUser, @Param("id") id: string, @Body() body: unknown) { return this.service.classify(user, id, z.object({ category: documentCategorySchema, branchId: z.string().nullable().optional() }).parse(body)); }
  @Post("restaurant/documents/:id/archive") archive(@CurrentUser() user: RequestUser, @Param("id") id: string) { return this.service.archive(user, id); }
  @Public() @Post("external/documents/upload-url") externalUpload(@Headers("x-api-key") key: string, @Body() body: unknown) { return this.service.externalUploadUrl(key, upload.parse(body)); }
  @Public() @Post("external/documents/:id/confirm") externalConfirm(@Headers("x-api-key") key: string, @Param("id") id: string) { return this.service.externalConfirm(key, id); }
}
