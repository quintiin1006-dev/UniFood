export function authConfig() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  return url && key ? { url, key } : null;
}

export const rememberCookie = "unifood-remember";

export function sessionCookieOptions(remember: boolean, deleting = false) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    ...(deleting ? { maxAge: 0 } : remember ? { maxAge: 60 * 60 * 24 * 30 } : {}),
  };
}
