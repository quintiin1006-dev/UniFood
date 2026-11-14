import {
  isCafeteriaId,
  parseCafeteriaAudit,
} from "@/features/super-admin/contracts";
import {
  forwardSuperAdmin,
  superAdminFailure,
} from "@/features/super-admin/server/forward";

export const dynamic = "force-dynamic";

/** Always the 20 most recent changes; the browser's query never reaches Spring. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ cafeteriaId: string }> },
) {
  const { cafeteriaId } = await params;
  if (!isCafeteriaId(cafeteriaId))
    return superAdminFailure(400, {
      code: "SUPER_ADMIN_INVALID_REQUEST",
      operation: "audit",
    });
  return forwardSuperAdmin(request, {
    path: `/api/super-admin/cafeterias/${cafeteriaId.toLowerCase()}/audit?limit=20`,
    parse: parseCafeteriaAudit,
    operation: "audit",
  });
}
