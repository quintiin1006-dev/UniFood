import { redirect } from "next/navigation";
import { requireAuth } from "@/features/auth/server/session";
import { destination, isClient } from "@/features/auth/validation";
import OrderHistory from "@/features/client-orders/components/OrderHistory";

export const metadata = { title: "Historial | UniFood" };
export const dynamic = "force-dynamic";

export default async function OrderHistoryPage() {
  const { profile } = await requireAuth();
  if (!isClient(profile)) redirect(destination(profile));
  return <OrderHistory />;
}
