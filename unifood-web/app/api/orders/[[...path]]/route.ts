const actions = new Set(["prepare", "ready", "call", "deliver", "cancel"]);

async function forward(request: Request, context: { params: Promise<{ path?: string[] }> }) {
  const { path = [] } = await context.params;
  const isList = request.method === "GET" && path.length === 0;
  const isAction = request.method === "PATCH" && path.length === 2 &&
    /^[0-9a-f-]{36}$/i.test(path[0]) && actions.has(path[1]);

  if (!isList && !isAction) {
    return Response.json({ message: "Ruta de pedidos no disponible." }, { status: 404 });
  }

  const base = (process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080").replace(/\/+$/, "");
  const url = new URL(`${base}/api/orders${path.length ? `/${path.join("/")}` : ""}`);
  if (isList) url.search = new URL(request.url).search;

  try {
    const headers = new Headers();
    const authorization = request.headers.get("authorization");
    if (authorization) headers.set("authorization", authorization);
    const response = await fetch(url, {
      method: request.method,
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    return new Response(response.body, {
      status: response.status,
      headers: {
        "Content-Type": response.headers.get("content-type") || "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return Response.json(
      { message: "No se pudo conectar con el backend de pedidos. Revisa que esté disponible." },
      { status: 502 },
    );
  }
}

export const GET = forward;
export const PATCH = forward;
