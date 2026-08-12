import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { ReservationsModule } from "../reservations/reservations.module";
import { OnlineBookingsController, PublicOnlineBookingsController } from "./online-bookings.controller";
import { OnlineBookingsService } from "./online-bookings.service";

@Module({
  imports: [ReservationsModule, AuditModule],
  controllers: [OnlineBookingsController, PublicOnlineBookingsController],
  providers: [OnlineBookingsService]
})
export class OnlineBookingsModule {}
