import { createHash, randomBytes } from "node:crypto";

export function createReservationCode() {
  return `${randomBytes(2).toString("hex").toUpperCase()}-${randomBytes(2).toString("hex").toUpperCase()}`;
}

export function createApiToken() {
  return randomBytes(24).toString("hex");
}

export function createRequestHash(payload: unknown) {
  const source = typeof payload === "string" ? payload : JSON.stringify(payload);
  return createHash("sha256").update(source).digest("hex");
}
