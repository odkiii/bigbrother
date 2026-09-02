import { timingSafeEqual } from "crypto";

export function requireSecret(
  provided: string | null | undefined,
  expected: string | undefined,
): boolean {
  if (!expected) return false;
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function getBearerOrQuerySecret(
  request: Request,
  queryKey = "secret",
): string | null {
  const auth = request.headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  const header = request.headers.get("x-bigbrother-secret");
  if (header) return header.trim();
  const url = new URL(request.url);
  return url.searchParams.get(queryKey);
}

export function isAllowedTelegramUser(userId: number | undefined): boolean {
  const allow = process.env.TELEGRAM_ALLOW_USER_IDS;
  if (!allow) return true;
  if (userId == null) return false;
  const ids = allow.split(",").map((s) => s.trim()).filter(Boolean);
  return ids.includes(String(userId));
}
