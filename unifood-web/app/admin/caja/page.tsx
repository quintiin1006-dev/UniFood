import { requireAdmin } from "@/features/admin/server/requireAdmin";
import { CashClosuresPanel } from "@/features/cash/components/CashClosuresPanel";

export default async function Page() {
  await requireAdmin();
  return <CashClosuresPanel />;
}
