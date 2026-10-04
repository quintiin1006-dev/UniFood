import { getAuth } from "@/features/auth/server/session";
import { isClient, sameOrigin } from "@/features/auth/validation";
import { serverApiUrl } from "@/config/server";

const errors: Record<number, { code: string; message: string }> = {
  400: { code: "INVALID_REQUEST", message: "Pedido no válido." },
  401: {
    code: "UNAUTHORIZED",
    message: "Inicia sesión para cancelar tu pedido.",
  },
  403: { code: "FORBIDDEN", message: "No puedes cancelar este pedido." },
  404: { code: "ORDER_NOT_FOUND", message: "El pedido no existe." },
  409: {
    code: "INVALID_ORDER_STATE",
    message: "Solo un pedido pendiente puede cancelarse.",
  },
  502: { code: "BAD_GATEWAY", message: "No se pudo cancelar el pedido." },
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

export async function PATCH(
  request: Request,
  context: { params: Promise<{ orderId: string }> },
) {
  if (!sameOrigin(request)) return error(request, 403);
  const auth = await getAuth();
  if (!auth) return error(request, 401);
  if (
    !isClient(auth.profile) ||
    auth.profile.roles.some((role) => role !== "CLIENT")
  )
    return error(request, 403);

  const { orderId } = await context.params;
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      orderId,
    )
  )
    return error(request, 400);

  const base = serverApiUrl();
  try {
    // Identity comes only from the verified session. No browser headers, body or query are forwarded.
    const response = await fetch(`${base}/api/me/orders/${orderId}/cancel`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${auth.accessToken}` },
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
      redirect: "error",
    });
    if (response.status !== 200)
      return error(request, response.status in errors ? response.status : 502);

    const result = await response.json();
    if (
      result?.id?.toLowerCase() !== orderId.toLowerCase() ||
      result?.status !== "CANCELLED"
    )
      return error(request, 502);
    // The browser needs only the acknowledgement, not the upstream order or session data.
    return Response.json(
      { id: result.id, status: "CANCELLED" },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return error(request, 502);
  }
}
