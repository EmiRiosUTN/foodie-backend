import { Controller, Get } from "@nestjs/common";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import type { RequestUser } from "../../common/auth/request-user";
import { RestaurantsService } from "./restaurants.service";

@Controller("restaurant")
export class RestaurantBootstrapController {
  constructor(private readonly restaurantsService: RestaurantsService) {}

  @Get("bootstrap")
  bootstrap(@CurrentUser() user: RequestUser) {
    return this.restaurantsService.bootstrap(user);
  }
}
