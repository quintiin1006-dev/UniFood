import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";
import {
  isTemporaryAuthFailure,
  temporaryAuthResponse,
} from "@/features/auth/server/failures";
import {
  authConfig,
  authCookieName,
  authCookieNames,
  rememberCookie,
  sessionCookieOptions,
} from "@/features/auth/server/config";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const config = authConfig();
  if (!config) return response;
  const remember = request.cookies.get(rememberCookie)?.value === "1";
  const incoming = request.cookies.getAll();
  const writes = new Map<string, { value: string; deleting: boolean }>();
  const client = createServerClient(config.url, config.key, {
    cookieOptions: { name: authCookieName(config.url) },
    global: {
      fetch: (input, init) =>
        fetch(input, {
          ...init,
          signal: AbortSignal.timeout(15000),
          cache: "no-store",
        }),
    },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(values) {
        for (const { name, value, options } of values) {
          writes.set(name, { value, deleting: options.maxAge === 0 });
          if (options.maxAge === 0) request.cookies.delete(name);
          else request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
      },
    },
  });
  let result: { data: { user: unknown }; error?: unknown };
  try {
    result = await client.auth.getUser();
  } catch (error) {
    if (isTemporaryAuthFailure(error))
      return temporaryAuthResponse(
        request.nextUrl.pathname.startsWith("/api/"),
      );
    result = { data: { user: null }, error };
  }
  const {
    data: { user },
    error,
  } = result;
  // Discard SDK writes on a transient failure, including attempted deletions.
  // The browser keeps exactly its incoming cookies and no protected content is rendered.
  if (error && isTemporaryAuthFailure(error))
    return temporaryAuthResponse(request.nextUrl.pathname.startsWith("/api/"));
  if (error || !user) {
    // Send the deletion on the redirect itself, before any Server Component can stream.
    // The original request is retained because the SDK may already have removed chunks.
    const names = new Set(
      authCookieNames(
        [
          ...incoming,
          ...request.cookies.getAll(),
          ...[...writes.keys()].map((name) => ({ name })),
        ],
        config.url,
      ),
    );
    for (const name of names) {
      request.cookies.delete(name);
      writes.set(name, { value: "", deleting: true });
    }
    request.cookies.delete(rememberCookie);
    writes.set(rememberCookie, { value: "", deleting: true });
    const path = request.nextUrl.pathname;
    if (path.startsWith("/api/")) {
      response = NextResponse.json(
        { message: "Inicia sesión para continuar.", code: "UNAUTHORIZED" },
        { status: 401 },
      );
    } else if (
      /^\/(worker|admin|super-admin)(\/|$)/.test(path) ||
      path === "/cuenta"
    ) {
      response = NextResponse.redirect(
        new URL(path === "/cuenta" ? "/login" : "/panel/login", request.url),
      );
    } else {
      response = NextResponse.next({ request });
    }
  }
  for (const [name, { value, deleting }] of writes) {
    response.cookies.set(name, value, sessionCookieOptions(remember, deleting));
  }
  response.headers.set(
    "Cache-Control",
    request.nextUrl.pathname.startsWith("/api/")
      ? "no-store"
      : "private, no-store",
  );
  return response;
}

export const config = {
  matcher: [
    "/login",
    "/panel/login",
    "/registro",
    "/recuperar-contrasena",
    "/worker/:path*",
    "/cuenta",
    "/admin/:path*",
    "/super-admin/:path*",
    "/api/orders/:path*",
    "/api/me/orders/:path*",
  ],
};
