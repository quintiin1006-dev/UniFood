import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";
import { authConfig, rememberCookie, sessionCookieOptions } from "@/features/auth/server/config";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const config = authConfig();
  if (!config) return response;
  const remember = request.cookies.get(rememberCookie)?.value === "1";
  const client = createServerClient(config.url, config.key, {
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15000), cache: "no-store" }) },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(values) {
        for (const { name, value } of values) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of values) {
          response.cookies.set(name, value, sessionCookieOptions(remember, options.maxAge === 0));
        }
      },
    },
  });
  await client.auth.getUser();
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = { matcher: ["/worker/:path*", "/cuenta", "/api/orders/:path*"] };
