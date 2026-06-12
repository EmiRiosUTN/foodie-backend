import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { CustomersService } from "./customers.service";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import type { RequestUser } from "../../common/auth/request-user";
import { z } from "zod";

const createCustomerSchema = z.object({
  branchId: z.string().optional(),
  fullName: z.string().min(2),
  phone: z.string().optional().nullable(),
  email: z.string().email().optional().nullable(),
  birthday: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  tags: z.array(z.string()).optional()
});

const updateCustomerSchema = z.object({
  fullName: z.string().optional(),
  phone: z.string().optional().nullable(),
  email: z.string().email().optional().nullable(),
  birthday: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  tags: z.array(z.string()).optional()
});

@Controller("restaurant/customers")
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Get()
  list(@CurrentUser() user: RequestUser, @Query("branchId") branchId?: string) {
    return this.customersService.list(user, branchId);
  }

  @Post()
  create(@CurrentUser() user: RequestUser, @Body() body: unknown) {
    return this.customersService.create(user, createCustomerSchema.parse(body));
  }

  @Get(":customerId")
  detail(@CurrentUser() user: RequestUser, @Param("customerId") customerId: string) {
    return this.customersService.detail(user, customerId);
  }

  @Patch(":customerId")
  update(
    @CurrentUser() user: RequestUser,
    @Param("customerId") customerId: string,
    @Body() body: unknown
  ) {
    return this.customersService.update(user, customerId, updateCustomerSchema.parse(body));
  }

  @Delete(":customerId")
  remove(@CurrentUser() user: RequestUser, @Param("customerId") customerId: string) {
    return this.customersService.remove(user, customerId);
  }
}
