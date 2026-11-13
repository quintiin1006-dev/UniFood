import {
  isCafeteriaId,
  parseSuperAdminCafeteria,
  parseVisibilityCommand,
} from "@/features/super-admin/contracts";
import {
  forwardSuperAdmin,
  superAdminFailure,
} from "@/features/super-admin/server/forward";

export const dynamic = "force-dynamic";

export async function PATCH(
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
    path: `/api/super-admin/cafeterias/${cafeteriaId.toLowerCase()}/visibility`,
    parse: parseSuperAdminCafeteria,
    operation: "save",
    body: {
      method: "PATCH",
      parse: parseVisibilityCommand,
      invalid: "SUPER_ADMIN_INVALID_REQUEST",
    },
  });
}
