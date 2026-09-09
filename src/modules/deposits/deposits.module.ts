import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { DepositsController } from "./deposits.controller";
import { DepositsService } from "./deposits.service";
import { R2StorageService } from "./r2-storage.service";
@Module({ imports: [AuditModule], controllers: [DepositsController], providers: [DepositsService, R2StorageService], exports: [DepositsService] })
export class DepositsModule {}
