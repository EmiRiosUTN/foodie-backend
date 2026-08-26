import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { ChatTagStylesController } from "./chat-tag-styles.controller";
import { ChatTagStylesService } from "./chat-tag-styles.service";

@Module({ imports: [AuditModule], controllers: [ChatTagStylesController], providers: [ChatTagStylesService] })
export class ChatTagStylesModule {}
