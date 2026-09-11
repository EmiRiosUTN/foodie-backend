import { createHash, randomBytes } from "node:crypto";

export function createReservationCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from(randomBytes(6), (byte) => alphabet[byte & 31]).join("");
}

export function normalizeReservationCode(value: string) {
  return value.trim().toUpperCase();
}

export function createApiToken() {
  return randomBytes(24).toString("hex");
}

export function createRequestHash(payload: unknown) {
  const source = typeof payload === "string" ? payload : JSON.stringify(payload);
  return createHash("sha256").update(source).digest("hex");
}
