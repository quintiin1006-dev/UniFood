import { serverAuthConfig } from "@/config/server";

export function authConfig() {
  return serverAuthConfig();
}

export const rememberCookie = "unifood-remember";

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
