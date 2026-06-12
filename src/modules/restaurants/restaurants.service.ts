import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { hashPassword } from "../../common/security/password";
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

  async createRestaurantUser(
    restaurantId: string,
    input: { fullName: string; email: string; password: string; role: "restaurant_owner" | "restaurant_manager" | "host" | "waiter" },
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

    await this.auditService.log({
      action: "restaurant_user.created",
      targetType: "restaurant_user",
      targetId: user.id,
      restaurantId,
      platformUserId: actor.sub,
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
      role?: "restaurant_owner" | "restaurant_manager" | "host" | "waiter";
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

    await this.auditService.log({
      action: "restaurant_user.updated",
      targetType: "restaurant_user",
      targetId: updated.id,
      restaurantId,
      platformUserId: actor.sub,
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
      platformUserId: actor.sub,
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
