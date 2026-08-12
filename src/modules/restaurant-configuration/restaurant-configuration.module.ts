import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { RestaurantConfigurationController } from "./restaurant-configuration.controller";
import { RestaurantConfigurationService } from "./restaurant-configuration.service";

@Module({ imports: [AuditModule], controllers: [RestaurantConfigurationController], providers: [RestaurantConfigurationService] })
export class RestaurantConfigurationModule {}
