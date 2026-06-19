import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import type { RequestUser } from "../../common/auth/request-user";
import { RestaurantsService } from "./restaurants.service";

const restaurantUserSchema = z.object({
  fullName: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(4),
  role: z.enum(["restaurant_owner", "restaurant_manager", "host", "waiter", "cashier", "kitchen"])
});

const updateRestaurantUserSchema = z
  .object({
    fullName: z.string().min(2).optional(),
    email: z.string().email().optional(),
    password: z.string().min(4).optional(),
    role: z.enum(["restaurant_owner", "restaurant_manager", "host", "waiter", "cashier", "kitchen"]).optional(),
    isActive: z.boolean().optional()
  })
  .refine((value) => Object.keys(value).length > 0, "At least one field is required");

const chatActivitySchema = z.object({
  action: z.string().min(1).max(80),
  status: z.enum(["success", "error"]),
  chatId: z.string().min(1),
  chatClientId: z.string().nullable().optional(),
  contactName: z.string().nullable().optional(),
  contactPhone: z.string().nullable().optional(),
  messageType: z.enum(["text", "media", "template"]),
  messageContent: z.string().nullable().optional(),
  templateId: z.string().nullable().optional(),
  templateName: z.string().nullable().optional(),
  templateParameters: z.unknown().optional(),
  fileName: z.string().nullable().optional(),
  fileMimeType: z.string().nullable().optional(),
  fileSize: z.number().int().nonnegative().nullable().optional(),
  externalMessageId: z.string().nullable().optional(),
  externalResponse: z.unknown().optional(),
  errorMessage: z.string().nullable().optional(),
  metadata: z.unknown().optional()
});

@Controller("restaurant")
export class RestaurantBootstrapController {
  constructor(private readonly restaurantsService: RestaurantsService) {}

  @Get("bootstrap")
  bootstrap(@CurrentUser() user: RequestUser) {
    return this.restaurantsService.bootstrap(user);
  }

  @Get("users")
  users(@CurrentUser() user: RequestUser) {
    return this.restaurantsService.listRestaurantUsers(user);
  }

  @Get("users/:userId")
  userDetail(@CurrentUser() user: RequestUser, @Param("userId") userId: string) {
    return this.restaurantsService.getRestaurantUserDetail(user, userId);
  }

  @Post("users")
  createUser(@CurrentUser() user: RequestUser, @Body() body: unknown) {
    return this.restaurantsService.createOwnRestaurantUser(user, restaurantUserSchema.parse(body));
  }

  @Patch("users/:userId")
  updateUser(@CurrentUser() user: RequestUser, @Param("userId") userId: string, @Body() body: unknown) {
    return this.restaurantsService.updateOwnRestaurantUser(user, userId, updateRestaurantUserSchema.parse(body));
  }

  @Delete("users/:userId")
  removeUser(@CurrentUser() user: RequestUser, @Param("userId") userId: string) {
    return this.restaurantsService.removeOwnRestaurantUser(user, userId);
  }

  @Get("activity")
  activity(@CurrentUser() user: RequestUser, @Query("limit") limit?: string, @Query("restaurantUserId") restaurantUserId?: string) {
    return this.restaurantsService.listRestaurantActivity(user, {
      limit: limit ? Number(limit) : undefined,
      restaurantUserId
    });
  }

  @Get("chat-activity")
  chatActivity(
    @CurrentUser() user: RequestUser,
    @Query("limit") limit?: string,
    @Query("chatId") chatId?: string,
    @Query("restaurantUserId") restaurantUserId?: string
  ) {
    return this.restaurantsService.listRestaurantChatActivity(user, {
      limit: limit ? Number(limit) : undefined,
      chatId,
      restaurantUserId
    });
  }

  @Post("chat-activity")
  createChatActivity(@CurrentUser() user: RequestUser, @Body() body: unknown) {
    return this.restaurantsService.createRestaurantChatActivity(user, chatActivitySchema.parse(body));
  }
}
