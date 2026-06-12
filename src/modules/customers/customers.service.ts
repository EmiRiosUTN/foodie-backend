import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import type { RequestUser } from "../../common/auth/request-user";

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  private normalizeEmail(email?: string | null) {
    return email?.trim().toLowerCase();
  }

  private restaurantScope(user: RequestUser) {
    if (user.scope !== "restaurant" || !user.restaurantId) {
      throw new ForbiddenException("Restaurant context required");
    }
    return user.restaurantId;
  }

  list(user: RequestUser, branchId?: string) {
    const restaurantId = this.restaurantScope(user);
    return this.prisma.customer.findMany({
      where: {
        restaurantId,
        ...(branchId ? { branchId } : {})
      },
      include: {
        tags: true,
        reservations: {
          orderBy: { serviceDate: "desc" },
          take: 5
        }
      },
      orderBy: { updatedAt: "desc" }
    });
  }

  async create(
    user: RequestUser,
    input: {
      branchId?: string;
      fullName: string;
      phone?: string | null;
      email?: string | null;
      birthday?: string | null;
      notes?: string | null;
      tags?: string[];
    }
  ) {
    const restaurantId = this.restaurantScope(user);
    const normalizedEmail = this.normalizeEmail(input.email);

    if (normalizedEmail) {
      const existing = await this.prisma.customer.findFirst({
        where: {
          restaurantId,
          email: normalizedEmail
        }
      });
      if (existing) {
        throw new ConflictException("A customer with that email already exists");
      }
    }

    const customer = await this.prisma.customer.create({
      data: {
        restaurantId,
        branchId: input.branchId,
        fullName: input.fullName,
        phone: input.phone?.trim() || null,
        email: normalizedEmail,
        birthday: input.birthday ? new Date(input.birthday) : null,
        notes: input.notes?.trim() || null
      }
    });

    if (input.tags?.length) {
      await this.prisma.customerTag.createMany({
        data: input.tags.map((label) => ({
          customerId: customer.id,
          restaurantId,
          label
        }))
      });
    }

    return this.prisma.customer.findUnique({
      where: { id: customer.id },
      include: {
        tags: true,
        reservations: {
          orderBy: { serviceDate: "desc" },
          take: 5
        }
      }
    });
  }

  async detail(user: RequestUser, customerId: string) {
    const restaurantId = this.restaurantScope(user);
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, restaurantId },
      include: {
        tags: true,
        reservations: {
          include: {
            room: true,
            tables: { include: { table: true } }
          },
          orderBy: { serviceDate: "desc" },
          take: 20
        }
      }
    });

    if (!customer) {
      throw new NotFoundException("Customer not found");
    }

    return customer;
  }

  async update(
    user: RequestUser,
    customerId: string,
    input: {
      fullName?: string;
      phone?: string | null;
      email?: string | null;
      birthday?: string | null;
      notes?: string | null;
      tags?: string[];
    }
  ) {
    const restaurantId = this.restaurantScope(user);
    const existing = await this.prisma.customer.findFirst({
      where: { id: customerId, restaurantId }
    });
    if (!existing) {
      throw new NotFoundException("Customer not found");
    }

    const normalizedEmail = this.normalizeEmail(input.email);
    if (normalizedEmail && normalizedEmail !== existing.email) {
      const duplicate = await this.prisma.customer.findFirst({
        where: {
          restaurantId,
          email: normalizedEmail,
          NOT: { id: customerId }
        }
      });
      if (duplicate) {
        throw new ConflictException("A customer with that email already exists");
      }
    }

    const customer = await this.prisma.customer.update({
      where: { id: customerId },
      data: {
        fullName: input.fullName,
        phone: input.phone !== undefined ? input.phone?.trim() || null : undefined,
        email: input.email !== undefined ? normalizedEmail || null : undefined,
        birthday: input.birthday !== undefined ? (input.birthday ? new Date(input.birthday) : null) : undefined,
        notes: input.notes !== undefined ? input.notes?.trim() || null : undefined
      }
    });

    if (input.tags) {
      await this.prisma.$transaction(async (tx) => {
        await tx.customerTag.deleteMany({ where: { restaurantId, customerId } });
        if (input.tags?.length) {
          await tx.customerTag.createMany({
            data: input.tags.map((label) => ({ customerId, restaurantId, label }))
          });
        }
      });
    }

    return this.prisma.customer.findUnique({
      where: { id: customer.id },
      include: {
        tags: true,
        reservations: {
          orderBy: { serviceDate: "desc" },
          take: 5
        }
      }
    });
  }

  async remove(user: RequestUser, customerId: string) {
    const restaurantId = this.restaurantScope(user);
    const existing = await this.prisma.customer.findFirst({
      where: { id: customerId, restaurantId }
    });

    if (!existing) {
      throw new NotFoundException("Customer not found");
    }

    await this.prisma.customer.delete({
      where: { id: customerId }
    });

    return { ok: true };
  }
}
