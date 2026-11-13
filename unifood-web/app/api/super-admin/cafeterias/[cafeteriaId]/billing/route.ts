import {
  isCafeteriaId,
  parseBillingCommand,
  parseSuperAdminCafeteria,
} from "@/features/super-admin/contracts";
import {
  forwardSuperAdmin,
  superAdminFailure,
} from "@/features/super-admin/server/forward";

export const dynamic = "force-dynamic";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ cafeteriaId: string }> },
) {
  const { cafeteriaId } = await params;
  if (!isCafeteriaId(cafeteriaId))
    return superAdminFailure(400, {
      code: "SUPER_ADMIN_INVALID_REQUEST",
      operation: "save",
    });
  return forwardSuperAdmin(request, {
    path: `/api/super-admin/cafeterias/${cafeteriaId.toLowerCase()}/billing`,
    parse: parseSuperAdminCafeteria,
    operation: "save",
    body: {
      method: "PUT",
      parse: parseBillingCommand,
      invalid: "BILLING_INVALID_REQUEST",
    },
  });
}
