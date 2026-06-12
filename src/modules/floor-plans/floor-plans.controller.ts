import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from "@nestjs/common";
import { FloorPlansService } from "./floor-plans.service";
import { Roles } from "../../common/auth/roles.decorator";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import type { RequestUser } from "../../common/auth/request-user";
import { z } from "zod";

const roomSchema = z.object({
  branchId: z.string().min(1),
  name: z.string().min(2),
  description: z.string().optional(),
  isOutdoor: z.boolean().optional()
});

const updateRoomSchema = z.object({
  name: z.string().min(2),
  description: z.string().optional(),
  isOutdoor: z.boolean().optional()
});

const layoutSchema = z.object({
  zones: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      slug: z.string().min(1)
    })
  ),
  items: z.array(
    z.object({
      id: z.string().min(1),
      kind: z.string().min(1),
      label: z.string().optional(),
      x: z.number(),
      y: z.number(),
      width: z.number(),
      height: z.number(),
      rotation: z.number().optional(),
      metadata: z.record(z.any()).optional()
    })
  ),
  tables: z.array(
    z.object({
      id: z.string().min(1),
      label: z.string().min(1),
      shape: z.string().min(1),
      seats: z.number().int().min(1),
      x: z.number(),
      y: z.number(),
      width: z.number(),
      height: z.number(),
      rotation: z.number().optional(),
      isReservable: z.boolean(),
      metadata: z.record(z.any()).optional(),
      zoneId: z.string().nullable().optional()
    })
  ),
  combinations: z.array(
    z.object({
      id: z.string().min(1),
      parentTableId: z.string().min(1),
      childTableId: z.string().min(1),
      combinedSeats: z.number().int().min(1)
    })
  )
});

@Controller("restaurant/rooms")
export class FloorPlansController {
  constructor(private readonly floorPlansService: FloorPlansService) {}

  @Get()
  list(@CurrentUser() user: RequestUser, @Query("branchId") branchId?: string) {
    return this.floorPlansService.list(user, branchId);
  }

  @Post()
  @Roles("restaurant_owner", "restaurant_manager")
  create(@Body() body: unknown, @CurrentUser() user: RequestUser) {
    return this.floorPlansService.create(user, roomSchema.parse(body));
  }

  @Patch(":roomId")
  @Roles("restaurant_owner", "restaurant_manager")
  update(
    @Param("roomId") roomId: string,
    @Body() body: unknown,
    @CurrentUser() user: RequestUser
  ) {
    return this.floorPlansService.update(user, roomId, updateRoomSchema.parse(body));
  }

  @Delete(":roomId")
  @Roles("restaurant_owner", "restaurant_manager")
  remove(@Param("roomId") roomId: string, @CurrentUser() user: RequestUser) {
    return this.floorPlansService.remove(user, roomId);
  }

  @Get(":roomId/layout")
  detail(@Param("roomId") roomId: string, @CurrentUser() user: RequestUser) {
    return this.floorPlansService.detail(user, roomId);
  }

  @Put(":roomId/layout")
  @Roles("restaurant_owner", "restaurant_manager")
  replaceLayout(
    @Param("roomId") roomId: string,
    @Body() body: unknown,
    @CurrentUser() user: RequestUser
  ) {
    return this.floorPlansService.replaceLayout(user, roomId, layoutSchema.parse(body));
  }
}
