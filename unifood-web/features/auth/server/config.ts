import { serverAuthConfig } from "@/config/server";

export function authConfig() {
  return serverAuthConfig();
}

export const rememberCookie = "unifood-remember";

// Explicitly use the SDK's default storage key, also for exhaustive chunk/PKCE cleanup.
export function authCookieName(url: string) {
  return `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;
}

export function authCookieNames(cookies: { name: string }[], url: string) {
  const key = authCookieName(url);
  return cookies
    .filter(
      ({ name }) =>
        name === key ||
        name.startsWith(`${key}.`) ||
        name.startsWith(`${key}-`),
    )
    .map(({ name }) => name);
}

export function sessionCookieOptions(remember: boolean, deleting = false) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    ...(deleting
      ? { maxAge: 0 }
      : remember
        ? { maxAge: 60 * 60 * 24 * 30 }
        : {}),
  };
}
