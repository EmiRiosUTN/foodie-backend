import type { PlatformRole, RestaurantRole } from "./roles.types";

export interface TokenPayload {
  sub: string;
  scope: "platform" | "restaurant";
  role: PlatformRole | RestaurantRole;
  email: string;
  fullName: string;
  restaurantId?: string;
}
