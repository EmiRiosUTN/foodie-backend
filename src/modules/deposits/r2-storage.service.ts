import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

@Injectable()
export class R2StorageService {
  private client(): S3Client {
    const endpoint = process.env.R2_ENDPOINT;
    const accessKeyId = process.env.R2_ACCESS_KEY_ID;
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
    if (!endpoint || !accessKeyId || !secretAccessKey || !process.env.R2_BUCKET) {
      throw new ServiceUnavailableException("Private document storage is not configured");
    }
    return new S3Client({ region: "auto", endpoint, credentials: { accessKeyId, secretAccessKey } });
  }

  private bucket() { return process.env.R2_BUCKET!; }

  uploadUrl(key: string, contentType: string) {
    return getSignedUrl(this.client(), new PutObjectCommand({ Bucket: this.bucket(), Key: key, ContentType: contentType }), { expiresIn: 300 });
  }

  downloadUrl(key: string, fileName: string) {
    return getSignedUrl(this.client(), new GetObjectCommand({ Bucket: this.bucket(), Key: key, ResponseContentDisposition: `inline; filename="${fileName.replace(/["\\]/g, "_")}"` }), { expiresIn: 120 });
  }
}
