import { Body, Controller, Get, Post } from "@nestjs/common";
import { RestaurantsService } from "./restaurants.service";
import { Roles } from "../../common/auth/roles.decorator";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import type { RequestUser } from "../../common/auth/request-user";
import { z } from "zod";

const onboardingSchema = z.object({
  restaurantName: z.string().min(2),
  slug: z.string().min(2),
  branchName: z.string().min(2),
  timezone: z.string().min(2),
  ownerFullName: z.string().min(2),
  ownerEmail: z.string().email(),
  ownerPassword: z.string().min(4)
});

@Controller("platform/restaurants")
@Roles("platform_admin")
export class RestaurantsController {
  constructor(private readonly restaurantsService: RestaurantsService) {}

  @Get()
  list() {
    return this.restaurantsService.list();
  }

  @Post("onboarding")
  onboarding(@Body() body: unknown, @CurrentUser() user: RequestUser) {
    return this.restaurantsService.onboarding(onboardingSchema.parse(body), user);
  }
}
