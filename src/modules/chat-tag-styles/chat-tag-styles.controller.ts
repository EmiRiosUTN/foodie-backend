import { BadRequestException, Body, Controller, Get, Param, Put } from "@nestjs/common";
import { z } from "zod";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import type { RequestUser } from "../../common/auth/request-user";
import { Roles } from "../../common/auth/roles.decorator";
import { ChatTagStylesService } from "./chat-tag-styles.service";

const colorSchema = z.object({ color: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, "El color debe ser hexadecimal") });

@Controller("restaurant/chat-tag-styles")
export class ChatTagStylesController {
  constructor(private readonly service: ChatTagStylesService) {}

  @Roles("restaurant_owner")
  @Get()
  list(@CurrentUser() user: RequestUser) { return this.service.list(user); }

  @Roles("restaurant_owner")
  @Put(":tagName")
  save(@CurrentUser() user: RequestUser, @Param("tagName") tagName: string, @Body() body: unknown) {
    try { return this.service.save(user, tagName, colorSchema.parse(body)); }
    catch (error) { if (error instanceof z.ZodError) throw new BadRequestException(error.issues[0]?.message || "Color inválido"); throw error; }
  }
}
