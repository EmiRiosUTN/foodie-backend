import { Module } from "@nestjs/common";
import { RealtimeModule } from "../realtime/realtime.module";
import { FloorPlansController } from "./floor-plans.controller";
import { FloorPlansService } from "./floor-plans.service";

@Module({
  imports: [RealtimeModule],
  controllers: [FloorPlansController],
  providers: [FloorPlansService]
})
export class FloorPlansModule {}
