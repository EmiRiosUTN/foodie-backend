import { Body, Controller, Get, Headers, Ip, Post } from "@nestjs/common";
import { z } from "zod";
import { AuthService } from "./auth.service";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import { Public } from "../../common/auth/public.decorator";
import type { RequestUser } from "../../common/auth/request-user";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(4),
  context: z.enum(["platform", "restaurant"]).optional()
});

const refreshSchema = z.object({
  refreshToken: z.string().min(20)
});

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post("login")
  login(
    @Body() body: unknown,
    @Headers("user-agent") userAgent: string | undefined,
    @Ip() ipAddress: string
  ) {
    return this.authService.login(loginSchema.parse(body), { userAgent, ipAddress });
  }

  @Public()
  @Post("refresh")
  refresh(
    @Body() body: unknown,
    @Headers("user-agent") userAgent: string | undefined,
    @Ip() ipAddress: string
  ) {
    return this.authService.refresh(refreshSchema.parse(body).refreshToken, { userAgent, ipAddress });
  }

  @Public()
  @Post("logout")
  logout(@Body() body: unknown) {
    return this.authService.logout(refreshSchema.parse(body).refreshToken);
  }

  @Get("me")
  me(@CurrentUser() user: RequestUser) {
    return user;
  }
}
