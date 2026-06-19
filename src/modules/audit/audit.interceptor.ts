import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import { Observable, tap } from "rxjs";
import { AuditService } from "./audit.service";
import type { RequestUser } from "../../common/auth/request-user";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly auditService: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<{
      method: string;
      route?: { path?: string };
      path?: string;
      originalUrl?: string;
      params?: Record<string, string>;
      user?: RequestUser;
    }>();

    const user = request.user;
    const method = request.method?.toUpperCase();
    const shouldAudit = Boolean(
      user?.scope === "restaurant" &&
      user.restaurantId &&
      method &&
      MUTATING_METHODS.has(method) &&
      !request.originalUrl?.includes("/auth/")
    );

    if (!shouldAudit || !user?.restaurantId) {
      return next.handle();
    }

    return next.handle().pipe(
      tap((result) => {
        const response = result as { id?: string; code?: string; success?: boolean } | undefined;
        const routePath = request.route?.path || request.path || request.originalUrl || "unknown";
        const targetId =
          response?.id ||
          response?.code ||
          Object.values(request.params || {})[0] ||
          "unknown";

        void this.auditService.log({
          action: `${method} ${routePath}`,
          targetType: routePath.split("/").filter(Boolean)[0] || "request",
          targetId,
          restaurantId: user.restaurantId,
          restaurantUserId: user.sub,
          metadata: {
            path: request.originalUrl || request.path,
            params: request.params || {}
          }
        });
      })
    );
  }
}
