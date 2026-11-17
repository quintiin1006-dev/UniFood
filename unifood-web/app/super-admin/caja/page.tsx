import { redirect } from "next/navigation";
import { requireAuth } from "@/features/auth/server/session";
import { destination, isSuperAdmin } from "@/features/auth/validation";
import { CashClosuresPanel } from "@/features/cash/components/CashClosuresPanel";

export const metadata = { title: "Cierres de caja | UniFood" };
export const dynamic = "force-dynamic";

/** Read-only closures of every cafeteria (docs/decisiones.md §14). */
export default async function SuperAdminCashPage() {
  const { profile } = await requireAuth("panel");
  if (!isSuperAdmin(profile)) redirect(destination(profile));
  return (
    <main className="super-admin-cash">
      <CashClosuresPanel superAdmin />
    </main>
  );
}
