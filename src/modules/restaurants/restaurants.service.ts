import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { hashPassword } from "../../common/security/password";
import { encryptSecret } from "../../common/security/encrypted-secret";
import { hashOpaqueToken } from "../../common/security/token-hash";
import { createApiToken } from "../../common/utils/code";
import { AuditService } from "../audit/audit.service";
import type { RequestUser } from "../../common/auth/request-user";

@Injectable()
export class RestaurantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService
  ) {}

  list() {
    return this.prisma.restaurant.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        branches: true,
        users: {
          select: { id: true, fullName: true, email: true, role: true, isActive: true }
        },
        integrationTokens: {
          select: { id: true, label: true, isActive: true, createdAt: true }
        },
        _count: {
          select: {
            rooms: true,
            customers: true,
            reservations: true
          }
        }
      }
    });
  }

  detail(restaurantId: string) {
    return this.prisma.restaurant.findUnique({
      where: { id: restaurantId },
      include: {
        branches: {
          orderBy: { createdAt: "asc" }
        },
        users: {
          select: { id: true, fullName: true, email: true, role: true, isActive: true, createdAt: true },
          orderBy: { createdAt: "asc" }
        },
        integrationTokens: {
          select: { id: true, label: true, isActive: true, lastUsedAt: true, createdAt: true },
          orderBy: { createdAt: "desc" }
        },
        _count: {
          select: { rooms: true, customers: true, reservations: true }
        }
      }
    });
  }

  bootstrap(user: RequestUser) {
    if (user.scope !== "restaurant" || !user.restaurantId) {
      throw new ForbiddenException("Restaurant context required");
    }

    return this.prisma.restaurant.findUnique({
      where: { id: user.restaurantId },
      select: {
        id: true,
        name: true,
        slug: true,
        profileImageUrl: true,
        branches: {
          include: {
            rooms: {
              include: {
                zones: true,
                tables: true
              }
            }
          }
        }
      }
    });
  }

  async onboarding(
    input: {
      restaurantName: string;
      slug: string;
      profileImageUrl?: string;
      branchName: string;
      timezone: string;
      ownerFullName: string;
      ownerEmail: string;
      ownerPassword: string;
    },
    actor: RequestUser
  ) {
    const rawApiToken = createApiToken();
    const tokenHash = hashOpaqueToken(rawApiToken);

    const created = await this.prisma.$transaction(async (tx) => {
      const restaurant = await tx.restaurant.create({
        data: {
          name: input.restaurantName,
          slug: input.slug,
          profileImageUrl: input.profileImageUrl || null,
          chatAuthEmail: input.ownerEmail,
          chatAuthSecret: encryptSecret(input.ownerPassword),
          branches: {
            create: {
              name: input.branchName,
              timezone: input.timezone
            }
          },
          users: {
            create: {
              fullName: input.ownerFullName,
              email: input.ownerEmail,
              passwordHash: hashPassword(input.ownerPassword),
              role: "restaurant_owner"
            }
          },
          integrationTokens: {
            create: {
              label: "Default AI reservation token",
              tokenHash
            }
          }
        },
        include: {
          branches: true,
          users: {
            select: { id: true, fullName: true, email: true, role: true }
          },
          integrationTokens: {
            select: { id: true, label: true, isActive: true }
          }
        }
      });

      await tx.auditLog.create({
        data: {
          platformUserId: actor.sub,
          action: "restaurant.onboarded",
          targetType: "restaurant",
          targetId: restaurant.id,
          restaurantId: restaurant.id,
          metadata: {
            ownerEmail: input.ownerEmail,
            branchName: input.branchName
          }
        }
      });

      return restaurant;
    });

    return {
      ...created,
      rawApiToken
    };
  }

  async createBranch(
    restaurantId: string,
    input: { name: string; timezone: string },
    actor: RequestUser
  ) {
    const restaurant = await this.prisma.restaurant.findUnique({ where: { id: restaurantId } });
    if (!restaurant) throw new NotFoundException("Restaurant not found");

    const branch = await this.prisma.branch.create({
      data: {
        restaurantId,
        name: input.name,
        timezone: input.timezone
      }
    });

    await this.auditService.log({
      action: "branch.created",
      targetType: "branch",
      targetId: branch.id,
      restaurantId,
      platformUserId: actor.sub,
      metadata: { branchName: input.name }
    });

    return branch;
  }

  private assertRestaurantActor(user: RequestUser) {
    if (user.scope !== "restaurant" || !user.restaurantId) {
      throw new ForbiddenException("Restaurant context required");
    }
    return user.restaurantId;
  }

  private canManageRestaurantUsers(user: RequestUser) {
    if (user.scope === "platform") return true;
    return user.role === "restaurant_owner";
  }

  listRestaurantUsers(user: RequestUser) {
    const restaurantId = this.assertRestaurantActor(user);
    if (!this.canManageRestaurantUsers(user)) throw new ForbiddenException("Insufficient role");
    return this.prisma.restaurantUser.findMany({
      where: { restaurantId },
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        createdBy: {
          select: { id: true, fullName: true, email: true }
        }
      },
      orderBy: { createdAt: "asc" }
    });
  }

  getRestaurantUserDetail(user: RequestUser, userId: string) {
    const restaurantId = this.assertRestaurantActor(user);
    if (!this.canManageRestaurantUsers(user)) throw new ForbiddenException("Insufficient role");

    return this.prisma.restaurantUser.findFirst({
      where: { id: userId, restaurantId },
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        createdBy: {
          select: { id: true, fullName: true, email: true }
        },
        _count: {
          select: {
            auditLogs: true,
            chatActivityLogs: true,
            createdUsers: true
          }
        }
      }
    });
  }

  listRestaurantActivity(user: RequestUser, input?: { limit?: number; restaurantUserId?: string }) {
    const restaurantId = this.assertRestaurantActor(user);
    if (!this.canManageRestaurantUsers(user)) throw new ForbiddenException("Insufficient role");
    return this.auditService.listForRestaurant(restaurantId, input);
  }

  listRestaurantChatActivity(user: RequestUser, input: { limit?: number; chatId?: string; restaurantUserId?: string }) {
    const restaurantId = this.assertRestaurantActor(user);
    if (!this.canManageRestaurantUsers(user)) throw new ForbiddenException("Insufficient role");
    const take = Math.min(Math.max(input.limit || 120, 1), 500);

    return this.prisma.chatActivityLog.findMany({
      where: {
        restaurantId,
        chatId: input.chatId,
        restaurantUserId: input.restaurantUserId
      },
      include: {
        restaurantUser: {
          select: { id: true, fullName: true, email: true, role: true }
        }
      },
      orderBy: { createdAt: "desc" },
      take
    });
  }

  async createRestaurantChatActivity(
    user: RequestUser,
    input: {
      action: string;
      status: string;
      chatId: string;
      chatClientId?: string | null;
      contactName?: string | null;
      contactPhone?: string | null;
      messageType: string;
      messageContent?: string | null;
      templateId?: string | null;
      templateName?: string | null;
      templateParameters?: unknown;
      fileName?: string | null;
      fileMimeType?: string | null;
      fileSize?: number | null;
      externalMessageId?: string | null;
      externalResponse?: unknown;
      errorMessage?: string | null;
      metadata?: unknown;
    }
  ) {
    const restaurantId = this.assertRestaurantActor(user);

    return this.prisma.chatActivityLog.create({
      data: {
        restaurantId,
        restaurantUserId: user.sub,
        action: input.action,
        status: input.status,
        chatId: input.chatId,
        chatClientId: input.chatClientId,
        contactName: input.contactName,
        contactPhone: input.contactPhone,
        messageType: input.messageType,
        messageContent: input.messageContent,
        templateId: input.templateId,
        templateName: input.templateName,
        templateParameters: input.templateParameters === undefined ? undefined : (input.templateParameters as Prisma.InputJsonValue),
        fileName: input.fileName,
        fileMimeType: input.fileMimeType,
        fileSize: input.fileSize,
        externalMessageId: input.externalMessageId,
        externalResponse: input.externalResponse === undefined ? undefined : (input.externalResponse as Prisma.InputJsonValue),
        errorMessage: input.errorMessage,
        metadata: input.metadata === undefined ? undefined : (input.metadata as Prisma.InputJsonValue)
      },
      include: {
        restaurantUser: {
          select: { id: true, fullName: true, email: true, role: true }
        }
      }
    });
  }

  async createOwnRestaurantUser(
    actor: RequestUser,
    input: { fullName: string; email: string; password: string; role: "restaurant_owner" | "restaurant_manager" | "host" | "waiter" | "cashier" | "kitchen" }
  ) {
    const restaurantId = this.assertRestaurantActor(actor);
    if (!this.canManageRestaurantUsers(actor)) throw new ForbiddenException("Insufficient role");
    return this.createRestaurantUser(restaurantId, input, actor);
  }

  async updateOwnRestaurantUser(
    actor: RequestUser,
    userId: string,
    input: {
      fullName?: string;
      email?: string;
      password?: string;
      role?: "restaurant_owner" | "restaurant_manager" | "host" | "waiter" | "cashier" | "kitchen";
      isActive?: boolean;
    }
  ) {
    const restaurantId = this.assertRestaurantActor(actor);
    if (!this.canManageRestaurantUsers(actor)) throw new ForbiddenException("Insufficient role");
    return this.updateRestaurantUser(restaurantId, userId, input, actor);
  }

  async removeOwnRestaurantUser(actor: RequestUser, userId: string) {
    const restaurantId = this.assertRestaurantActor(actor);
    if (!this.canManageRestaurantUsers(actor)) throw new ForbiddenException("Insufficient role");
    if (actor.sub === userId) throw new ConflictException("Cannot delete current user");
    return this.removeRestaurantUser(restaurantId, userId, actor);
  }

  async createRestaurantUser(
    restaurantId: string,
    input: { fullName: string; email: string; password: string; role: "restaurant_owner" | "restaurant_manager" | "host" | "waiter" | "cashier" | "kitchen" },
    actor: RequestUser
  ) {
    const restaurant = await this.prisma.restaurant.findUnique({ where: { id: restaurantId } });
    if (!restaurant) throw new NotFoundException("Restaurant not found");

    const exists = await this.prisma.restaurantUser.findFirst({
      where: { restaurantId, email: input.email }
    });
    if (exists) throw new ConflictException("Restaurant user already exists");

    const user = await this.prisma.restaurantUser.create({
      data: {
        restaurantId,
        createdByUserId: actor.scope === "restaurant" ? actor.sub : undefined,
        fullName: input.fullName,
        email: input.email,
        passwordHash: hashPassword(input.password),
        role: input.role
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        isActive: true,
        createdAt: true
      }
    });

    if (input.role === "restaurant_owner") {
      await this.prisma.restaurant.update({
        where: { id: restaurantId },
        data: {
          chatAuthEmail: input.email,
          chatAuthSecret: encryptSecret(input.password)
        }
      });
    }

    await this.auditService.log({
      action: "restaurant_user.created",
      targetType: "restaurant_user",
      targetId: user.id,
      restaurantId,
      platformUserId: actor.scope === "platform" ? actor.sub : null,
      restaurantUserId: actor.scope === "restaurant" ? actor.sub : null,
      metadata: { email: input.email, role: input.role }
    });

    return user;
  }

  async updateRestaurantUser(
    restaurantId: string,
    userId: string,
    input: {
      fullName?: string;
      email?: string;
      password?: string;
      role?: "restaurant_owner" | "restaurant_manager" | "host" | "waiter" | "cashier" | "kitchen";
      isActive?: boolean;
    },
    actor: RequestUser
  ) {
    const restaurant = await this.prisma.restaurant.findUnique({ where: { id: restaurantId } });
    if (!restaurant) throw new NotFoundException("Restaurant not found");

    const existingUser = await this.prisma.restaurantUser.findFirst({
      where: { id: userId, restaurantId }
    });
    if (!existingUser) throw new NotFoundException("Restaurant user not found");

    if (input.email && input.email !== existingUser.email) {
      const duplicated = await this.prisma.restaurantUser.findFirst({
        where: {
          restaurantId,
          email: input.email,
          NOT: { id: userId }
        }
      });
      if (duplicated) throw new ConflictException("Restaurant user already exists");
    }

    if (existingUser.role === "restaurant_owner" && (input.role && input.role !== "restaurant_owner" || input.isActive === false)) {
      const owners = await this.prisma.restaurantUser.count({
        where: {
          restaurantId,
          role: "restaurant_owner",
          isActive: true
        }
      });

      if (owners <= 1) {
        throw new ConflictException("At least one active restaurant owner is required");
      }
    }

    const nextRole = input.role || existingUser.role;
    const nextEmail = input.email || existingUser.email;

    const updated = await this.prisma.restaurantUser.update({
      where: { id: userId },
      data: {
        fullName: input.fullName,
        email: input.email,
        role: input.role,
        isActive: input.isActive,
        passwordHash: input.password ? hashPassword(input.password) : undefined
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        isActive: true,
        createdAt: true,
        updatedAt: true
      }
    });

    if (nextRole === "restaurant_owner" && input.password) {
      await this.prisma.restaurant.update({
        where: { id: restaurantId },
        data: {
          chatAuthEmail: nextEmail,
          chatAuthSecret: encryptSecret(input.password)
        }
      });
    } else if (existingUser.role === "restaurant_owner" && input.email && !input.password) {
      await this.prisma.restaurant.update({
        where: { id: restaurantId },
        data: {
          chatAuthEmail: input.email
        }
      });
    }

    await this.auditService.log({
      action: "restaurant_user.updated",
      targetType: "restaurant_user",
      targetId: updated.id,
      restaurantId,
      platformUserId: actor.scope === "platform" ? actor.sub : null,
      restaurantUserId: actor.scope === "restaurant" ? actor.sub : null,
      metadata: {
        changedFields: Object.keys(input)
      }
    });

    return updated;
  }

  async removeRestaurantUser(restaurantId: string, userId: string, actor: RequestUser) {
    const restaurant = await this.prisma.restaurant.findUnique({ where: { id: restaurantId } });
    if (!restaurant) throw new NotFoundException("Restaurant not found");

    const existingUser = await this.prisma.restaurantUser.findFirst({
      where: { id: userId, restaurantId }
    });
    if (!existingUser) throw new NotFoundException("Restaurant user not found");

    if (existingUser.role === "restaurant_owner") {
      const owners = await this.prisma.restaurantUser.count({
        where: {
          restaurantId,
          role: "restaurant_owner",
          isActive: true,
          NOT: { id: userId }
        }
      });

      if (owners < 1) {
        throw new ConflictException("At least one active restaurant owner is required");
      }
    }

    await this.prisma.restaurantUser.delete({
      where: { id: userId }
    });

    await this.auditService.log({
      action: "restaurant_user.deleted",
      targetType: "restaurant_user",
      targetId: userId,
      restaurantId,
      platformUserId: actor.scope === "platform" ? actor.sub : null,
      restaurantUserId: actor.scope === "restaurant" ? actor.sub : null,
      metadata: {
        email: existingUser.email,
        role: existingUser.role
      }
    });

    return { success: true };
  }

  async rotateIntegrationToken(
    restaurantId: string,
    input: { label: string },
    actor: RequestUser
  ) {
    const restaurant = await this.prisma.restaurant.findUnique({ where: { id: restaurantId } });
    if (!restaurant) throw new NotFoundException("Restaurant not found");

    const rawApiToken = createApiToken();
    const tokenHash = hashOpaqueToken(rawApiToken);

    const token = await this.prisma.$transaction(async (tx) => {
      await tx.integrationToken.updateMany({
        where: { restaurantId, isActive: true },
        data: { isActive: false }
      });

      const created = await tx.integrationToken.create({
        data: {
          restaurantId,
          label: input.label,
          tokenHash
        },
        select: {
          id: true,
          label: true,
          isActive: true,
          createdAt: true
        }
      });

      await tx.auditLog.create({
        data: {
          action: "integration_token.rotated",
          targetType: "integration_token",
          targetId: created.id,
          restaurantId,
          platformUserId: actor.sub,
          metadata: { label: input.label }
        }
      });

      return created;
    });

    return {
      ...token,
      rawApiToken
    };
  }
}
