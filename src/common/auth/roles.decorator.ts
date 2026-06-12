import { SetMetadata } from "@nestjs/common";
import type { PlatformRole, RestaurantRole } from "./roles.types";

export const ROLES_KEY = "roles";
export const Roles = (...roles: Array<PlatformRole | RestaurantRole>) => SetMetadata(ROLES_KEY, roles);
