import { CURRENT_TERMS_VERSION } from "@/features/auth/legal";
import { authClient } from "@/features/auth/server/client";
import {
  isAuthServiceUnavailable,
  temporaryAuthResponse,
} from "@/features/auth/server/failures";
import { getAuth } from "@/features/auth/server/session";
import { sessionTermsState } from "@/features/auth/server/sessionTerms";
import { isClient, sameOrigin } from "@/features/auth/validation";

const errors: Record<number, { code: string; message: string }> = {
  401: { code: "UNAUTHORIZED", message: "Inicia sesión para continuar." },
  403: {
    code: "FORBIDDEN",
    message: "No puedes aceptar los términos desde aquí.",
  },
  502: {
    code: "TERMS_NOT_SAVED",
    message: "No pudimos guardar tu aceptación. Inténtalo de nuevo.",
  },
  503: {
    code: "TERMS_UNAVAILABLE",
    message: "No pudimos verificar los términos. Inténtalo de nuevo.",
  },
};

function error(request: Request, status: number) {
  return Response.json(
    {
      ...errors[status],
      status,
      path: new URL(request.url).pathname,
      timestamp: new Date().toISOString(),
    },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

/** The signed-in client, or the response that replaces it. */
async function requireClient(request: Request, mutating: boolean) {
  if (mutating && !sameOrigin(request)) return error(request, 403);
  let auth: Awaited<ReturnType<typeof getAuth>>;
  try {
    auth = await getAuth();
  } catch (cause) {
    if (isAuthServiceUnavailable(cause)) return temporaryAuthResponse();
    throw cause;
  }
  if (!auth) return error(request, 401);
  if (
    !isClient(auth.profile) ||
    auth.profile.roles.some((role) => role !== "CLIENT")
  )
    return error(request, 403);
  return null;
}

/** Whether this client still has to accept, for the retry of the terms screen. */
export async function GET(request: Request) {
  const refused = await requireClient(request, false);
  if (refused) return refused;
  const state = await sessionTermsState();
  if (state === "unavailable") return error(request, 503);
  return Response.json(
    { accepted: state === "accepted", version: CURRENT_TERMS_VERSION },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/** Records the signed-in client's acceptance of CURRENT_TERMS_VERSION. Only the client's own row. */
export async function POST(request: Request) {
  const refused = await requireClient(request, true);
  if (refused) return refused;

  const client = await authClient();
  const { error: saveError } = await client.rpc("accept_client_terms", {
    current_version: CURRENT_TERMS_VERSION,
  });
  if (saveError) return error(request, 502);
  return Response.json(
    { accepted: true, version: CURRENT_TERMS_VERSION },
    { headers: { "Cache-Control": "no-store" } },
  );
}
