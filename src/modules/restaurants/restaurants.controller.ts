import { BadRequestException, Body, Controller, Get, Post, Req, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { RestaurantsService } from "./restaurants.service";
import { Roles } from "../../common/auth/roles.decorator";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import type { RequestUser } from "../../common/auth/request-user";
import { z } from "zod";

const onboardingSchema = z.object({
  restaurantName: z.string().min(2),
  slug: z.string().min(2),
  profileImageUrl: z.string().max(1000).optional(),
  branchName: z.string().min(2),
  timezone: z.string().min(2),
  ownerFullName: z.string().min(2),
  ownerEmail: z.string().email(),
  ownerPassword: z.string().min(4)
});

type UploadedImage = {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
};

type UploadRequest = {
  protocol?: string;
  headers: Record<string, string | string[] | undefined>;
  get(name: string): string | undefined;
};

const imageExtensionByMimeType: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp"
};

function getPublicBaseUrl(request: UploadRequest) {
  const configured = process.env.PUBLIC_API_ORIGIN || process.env.APP_PUBLIC_URL;
  if (configured) return configured.replace(/\/$/, "");

  const forwardedProto = request.headers["x-forwarded-proto"];
  const proto = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto;
  const protocol = proto || request.protocol || "http";
  const host = request.get("host") || "localhost:4000";
  return `${protocol}://${host}`;
}

@Controller("platform/restaurants")
@Roles("platform_admin")
export class RestaurantsController {
  constructor(private readonly restaurantsService: RestaurantsService) {}

  @Get()
  list() {
    return this.restaurantsService.list();
  }

  @Post("onboarding")
  onboarding(@Body() body: unknown, @CurrentUser() user: RequestUser) {
    return this.restaurantsService.onboarding(onboardingSchema.parse(body), user);
  }

  @Post("profile-image")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 2 * 1024 * 1024 } }))
  async uploadProfileImage(@UploadedFile() file: UploadedImage | undefined, @Req() request: UploadRequest) {
    if (!file) {
      throw new BadRequestException("Image file is required");
    }

    const extension = imageExtensionByMimeType[file.mimetype];
    if (!extension) {
      throw new BadRequestException("Only JPG, PNG or WEBP images are allowed");
    }

    const relativeDirectory = join("restaurants", "profiles");
    const targetDirectory = join(process.cwd(), "uploads", relativeDirectory);
    await mkdir(targetDirectory, { recursive: true });

    const fileName = `${randomUUID()}.${extension}`;
    await writeFile(join(targetDirectory, fileName), file.buffer);

    const publicPath = `/uploads/restaurants/profiles/${fileName}`;
    return {
      url: `${getPublicBaseUrl(request)}${publicPath}`,
      path: publicPath
    };
  }
}
