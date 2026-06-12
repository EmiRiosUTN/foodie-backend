import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { RequestUser } from "./request-user";

export const CurrentUser = createParamDecorator((_: unknown, context: ExecutionContext): RequestUser | undefined => {
  const request = context.switchToHttp().getRequest();
  return request.user;
});
