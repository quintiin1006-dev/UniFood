import { parseSuperAdminCafeterias } from "@/features/super-admin/contracts";
import { forwardSuperAdmin } from "@/features/super-admin/server/forward";

export function GET(request: Request) {
  return forwardSuperAdmin(request, {
    path: "/api/super-admin/cafeterias",
    parse: parseSuperAdminCafeterias,
  });
}
