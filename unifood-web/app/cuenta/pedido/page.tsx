import { redirect } from "next/navigation";
import { requireAuth } from "@/features/auth/server/session";
import { destination, isClient } from "@/features/auth/validation";
import MyOrder from "@/features/client-orders/components/MyOrder";

export const metadata = { title: "Mi pedido | UniFood" };
export const dynamic = "force-dynamic";

export default async function MyOrderPage() {
  const { profile } = await requireAuth();
  if (!isClient(profile)) redirect(destination(profile));
  return <MyOrder />;
}
