export const RUNTIME_ARTIFACT_ID = "2026-08-20-758b14b0";
export const RUNTIME_MANIFEST_SHA256 =
  "1c22a7c19dd3be74f27b5c30b39522f21dad81f1bd023cc22cfb2b174d4a22f1";
export const RUNTIME_VERSION = "1.0.0";
export const RUNTIME_TIME_ZONE = "America/Los_Angeles";
export const OPERATING_CONTEXT_VERSION = "1.0.5";
export const OPERATING_CONTEXT_SHA256 =
  "3d37919bd06c135e36d0b99c50df0041c940db26bde0af7000e6b0ec2c240e82";
export const MAX_PERMIT_LIFETIME_MS = 60 * 60 * 1000;

export type RuntimePermitClaims = {
  version: 2;
  runtimeVersion: string;
  artifactId: string;
  manifestSha256: string;
  operatingContextVersion: string;
  operatingContextSha256: string;
  operatingMode: "PRODUCTION";
  readiness: "READY";
  businessDate: string;
  issuedAt: number;
  expiresAt: number;
  permitId: string;
};

export type PermitValidation =
  | { ok: true; claims: RuntimePermitClaims }
  | { ok: false; errorCode: string; message: string; permitFingerprint: string };

const encoder = new TextEncoder();
const binding = [
  RUNTIME_VERSION,
  RUNTIME_ARTIFACT_ID,
  RUNTIME_MANIFEST_SHA256,
  OPERATING_CONTEXT_VERSION,
  OPERATING_CONTEXT_SHA256,
].join("|");

function encode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decode(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid base64url");
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4 - (normalized.length % 4)) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function key(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

async function digest(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
  return Array.from(bytes.slice(0, 8), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function permitFingerprint(value: string): Promise<string> {
  return digest(value);
}

function laParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: RUNTIME_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const number = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  return { year: number("year"), month: number("month"), day: number("day"), hour: number("hour"), minute: number("minute"), second: number("second") };
}

export function losAngelesBusinessDate(date: Date): string {
  const { year, month, day } = laParts(date);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function laOffsetMs(date: Date): number {
  const p = laParts(date);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(date.getTime() / 1000) * 1000;
}

function nextDayBoundary(date: Date): Date {
  const current = laParts(date);
  const next = new Date(Date.UTC(current.year, current.month - 1, current.day + 1));
  const target = Date.UTC(next.getUTCFullYear(), next.getUTCMonth(), next.getUTCDate());
  let candidate = new Date(target);
  for (let attempt = 0; attempt < 3; attempt += 1) candidate = new Date(target - laOffsetMs(candidate));
  return candidate;
}

function uuidBytes(uuid: string): Uint8Array {
  return Uint8Array.from(uuid.replace(/-/g, "").match(/.{2}/g)!, (pair) => Number.parseInt(pair, 16));
}

function bytesUuid(bytes: Uint8Array): string {
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function signToken(prefix: "rp2" | "oc1", payload: Uint8Array, secret: string): Promise<string> {
  const encoded = encode(payload);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", await key(secret), encoder.encode(`${prefix}.${encoded}|${binding}`)));
  return `${prefix}.${encoded}.${encode(signature)}`;
}

async function verifyToken(prefix: "rp2" | "oc1", token: string, secret: string): Promise<Uint8Array | null> {
  const [actualPrefix, payload, signature, extra] = token.split(".");
  if (actualPrefix !== prefix || !payload || !signature || extra) throw new Error("Malformed token");
  const valid = await crypto.subtle.verify("HMAC", await key(secret), decode(signature), encoder.encode(`${prefix}.${payload}|${binding}`));
  return valid ? decode(payload) : null;
}

export async function issueRuntimePermit(secret: string, now = new Date()) {
  const issuedAt = Math.floor(now.getTime() / 1000);
  const expiresAt = Math.floor(Math.min(now.getTime() + MAX_PERMIT_LIFETIME_MS, nextDayBoundary(now).getTime()) / 1000);
  const id = crypto.randomUUID();
  const payload = new Uint8Array(25);
  const view = new DataView(payload.buffer);
  payload[0] = 2;
  view.setUint32(1, issuedAt);
  view.setUint32(5, expiresAt);
  payload.set(uuidBytes(id), 9);
  const claims: RuntimePermitClaims = {
    version: 2, runtimeVersion: RUNTIME_VERSION, artifactId: RUNTIME_ARTIFACT_ID,
    manifestSha256: RUNTIME_MANIFEST_SHA256, operatingContextVersion: OPERATING_CONTEXT_VERSION,
    operatingContextSha256: OPERATING_CONTEXT_SHA256, operatingMode: "PRODUCTION", readiness: "READY",
    businessDate: losAngelesBusinessDate(now), issuedAt, expiresAt, permitId: id,
  };
  const runtimePermit = await signToken("rp2", payload, secret);
  return { runtimePermit, claims, permitFingerprint: await permitFingerprint(runtimePermit) };
}

export async function validateRuntimePermit(runtimePermit: string, secret: string, now = new Date()): Promise<PermitValidation> {
  const fingerprint = await permitFingerprint(runtimePermit);
  if (!secret) return { ok: false, errorCode: "RUNTIME_PERMIT_CONFIGURATION_ERROR", message: "Runtime permit validation is unavailable.", permitFingerprint: fingerprint };
  try {
    const payload = await verifyToken("rp2", runtimePermit, secret);
    if (!payload) return { ok: false, errorCode: "RUNTIME_PERMIT_TAMPERED", message: "The runtime permit signature is invalid.", permitFingerprint: fingerprint };
    if (payload.length !== 25 || payload[0] !== 2) throw new Error("Invalid payload");
    const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    const issuedAt = view.getUint32(1), expiresAt = view.getUint32(5), nowSeconds = Math.floor(now.getTime() / 1000);
    if (expiresAt <= issuedAt || expiresAt - issuedAt > MAX_PERMIT_LIFETIME_MS / 1000 || nowSeconds < issuedAt - 30 || nowSeconds >= expiresAt) {
      return { ok: false, errorCode: "RUNTIME_PERMIT_EXPIRED", message: "The runtime permit has expired or has an invalid lifetime.", permitFingerprint: fingerprint };
    }
    const issuedDate = losAngelesBusinessDate(new Date(issuedAt * 1000));
    if (issuedDate !== losAngelesBusinessDate(now)) return { ok: false, errorCode: "RUNTIME_PERMIT_WRONG_DAY", message: "The runtime permit is not valid for the current Los Angeles business date.", permitFingerprint: fingerprint };
    return { ok: true, claims: { version: 2, runtimeVersion: RUNTIME_VERSION, artifactId: RUNTIME_ARTIFACT_ID, manifestSha256: RUNTIME_MANIFEST_SHA256, operatingContextVersion: OPERATING_CONTEXT_VERSION, operatingContextSha256: OPERATING_CONTEXT_SHA256, operatingMode: "PRODUCTION", readiness: "READY", businessDate: issuedDate, issuedAt, expiresAt, permitId: bytesUuid(payload.slice(9)) } };
  } catch {
    return { ok: false, errorCode: "INVALID_RUNTIME_PERMIT", message: "The runtime permit is malformed.", permitFingerprint: fingerprint };
  }
}

export async function issueContextChallenge(secret: string, now = new Date()): Promise<string> {
  const payload = new Uint8Array(24);
  const view = new DataView(payload.buffer);
  view.setUint32(0, Math.floor(now.getTime() / 1000));
  view.setUint32(4, Math.floor(now.getTime() / 1000) + 10 * 60);
  payload.set(uuidBytes(crypto.randomUUID()), 8);
  return signToken("oc1", payload, secret);
}

export async function validateContextChallenge(token: string, secret: string, now = new Date()): Promise<boolean> {
  try {
    const payload = await verifyToken("oc1", token, secret);
    if (!payload || payload.length !== 24) return false;
    const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    const issuedAt = view.getUint32(0), expiresAt = view.getUint32(4), current = Math.floor(now.getTime() / 1000);
    return current >= issuedAt - 30 && current < expiresAt && expiresAt - issuedAt === 600;
  } catch { return false; }
}
