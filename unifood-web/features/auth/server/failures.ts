const invalidSessionCodes = new Set([
  "refresh_token_not_found",
  "refresh_token_expired",
  "refresh_token_revoked",
  "invalid_refresh_token",
  "refresh_token_already_used",
  "session_not_found",
  "session_expired",
  "bad_jwt",
  "jwt_expired",
  "user_not_found",
  "user_banned",
]);

// Unknown failures do not prove that a session is invalid. Deny access, but retain it.
export function isTemporaryAuthFailure(error: unknown) {
  if (!error) return false;
  const failure = error as { name?: string; code?: string; status?: number };
  if (
    failure.name === "AuthRetryableFetchError" ||
    failure.name === "TimeoutError" ||
    failure.name === "AbortError" ||
    failure.status === 0 ||
    failure.status === 408 ||
    failure.status === 429 ||
    (failure.status !== undefined && failure.status >= 500)
  )
    return true;
  return !(
    failure.name === "AuthSessionMissingError" ||
    invalidSessionCodes.has(failure.code ?? "") ||
    failure.status === 401 ||
    failure.status === 403
  );
}

export const authUnavailableMessage =
  "No pudimos verificar tu sesión en este momento. Inténtalo nuevamente.";

export class AuthServiceUnavailableError extends Error {
  readonly code = "AUTH_TEMPORARILY_UNAVAILABLE";
  constructor() {
    super(authUnavailableMessage);
    this.name = "AuthServiceUnavailableError";
  }
}

export function isAuthServiceUnavailable(error: unknown) {
  return (
    error instanceof Error &&
    "code" in error &&
    error.code === "AUTH_TEMPORARILY_UNAVAILABLE"
  );
}

export function temporaryAuthResponse(api = true) {
  const headers = {
    "Cache-Control": api ? "no-store" : "private, no-store",
    "Retry-After": "5",
  };
  if (api)
    return Response.json(
      { code: "AUTH_TEMPORARILY_UNAVAILABLE", message: authUnavailableMessage },
      { status: 503, headers },
    );
  // No automatic redirect/reload: the current URL can be retried without a login loop.
  return new Response(
    `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>UniFood — Acceso temporalmente no disponible</title></head><body style="margin:0;font-family:system-ui,sans-serif;background:#f5f5f5;color:#172b23"><main style="min-height:100vh;display:grid;place-content:center;padding:24px;text-align:center"><h1>Acceso temporalmente no disponible</h1><p role="alert">${authUnavailableMessage}</p><a href="">Volver a intentar</a></main></body></html>`,
    {
      status: 503,
      headers: { ...headers, "Content-Type": "text/html; charset=utf-8" },
    },
  );
}
