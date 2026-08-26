import { ConflictException, ForbiddenException, Injectable } from "@nestjs/common";
import type { RequestUser } from "../../common/auth/request-user";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class ChatTagStylesService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  private owner(user: RequestUser) {
    if (user.scope !== "restaurant" || user.role !== "restaurant_owner" || !user.restaurantId) throw new ForbiddenException("Solo el dueño puede gestionar colores de tags");
    return user.restaurantId;
  }

  async list(user: RequestUser) {
    const restaurantId = this.owner(user);
    return this.prisma.chatTagStyle.findMany({ where: { restaurantId }, select: { tagName: true, color: true } });
  }

  async save(user: RequestUser, tagName: string, input: { color: string }) {
    const restaurantId = this.owner(user);
    const normalizedTagName = tagName.trim().toLowerCase();
    if (!normalizedTagName) throw new ConflictException("La tag es requerida");
    const style = await this.prisma.chatTagStyle.upsert({
      where: { restaurantId_tagName: { restaurantId, tagName: normalizedTagName } },
      create: { restaurantId, tagName: normalizedTagName, color: input.color.toUpperCase() },
      update: { color: input.color.toUpperCase() }
    });
    await this.audit.log({ action: "chat_tag_style.updated", targetType: "chat_tag_style", targetId: style.id, restaurantId, restaurantUserId: user.sub, metadata: { tagName: normalizedTagName, color: style.color } });
    return { tagName: style.tagName, color: style.color };
  }
}
