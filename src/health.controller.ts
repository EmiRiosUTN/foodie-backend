import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { Public } from "./common/auth/public.decorator";
import { PrismaService } from "./modules/prisma/prisma.service";

@Controller("health")
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  async check() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: "ok" };
    } catch {
      throw new ServiceUnavailableException({ status: "unavailable" });
    }
  }
}
