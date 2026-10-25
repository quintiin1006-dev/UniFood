import { forwardAdminDashboard } from "@/features/admin-dashboard/server/forward";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return forwardAdminDashboard(request);
}

// Explicit rejections ensure Next's automatic 405/HEAD/OPTIONS do not bypass no-store.
function methodNotAllowed() {
  return Response.json(
    {
      status: 405,
      code: "METHOD_NOT_ALLOWED",
      message: "Utiliza GET para consultar el dashboard.",
    },
    { status: 405, headers: { "Cache-Control": "no-store", Allow: "GET" } },
  );
}
export {
  methodNotAllowed as POST,
  methodNotAllowed as PUT,
  methodNotAllowed as PATCH,
  methodNotAllowed as DELETE,
  methodNotAllowed as HEAD,
  methodNotAllowed as OPTIONS,
};
