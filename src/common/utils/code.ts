import { createHash, randomBytes } from "node:crypto";

const humanCodeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function createHumanCode(length: number) {
  return Array.from(randomBytes(length), (byte) => humanCodeAlphabet[byte & 31]).join("");
}

export function createReservationCode() {
  return createHumanCode(6);
}

export function createGiftCardCode() {
  return createHumanCode(8);
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
