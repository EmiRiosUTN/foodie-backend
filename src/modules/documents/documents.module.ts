import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { DepositsModule } from "../deposits/deposits.module";
import { DocumentsController } from "./documents.controller";
import { DocumentsService } from "./documents.service";

@Module({ imports: [AuditModule, DepositsModule], controllers: [DocumentsController], providers: [DocumentsService] })
export class DocumentsModule {}
