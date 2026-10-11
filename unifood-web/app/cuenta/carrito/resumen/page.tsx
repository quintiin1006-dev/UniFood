import { redirect } from "next/navigation";
import { requireAuth } from "@/features/auth/server/session";
import { destination, isClient } from "@/features/auth/validation";
import ClientCheckout from "@/features/client/components/ClientCheckout";

export const metadata = { title: "Resumen del pedido | UniFood" };

export default async function ClientCheckoutPage() {
  const { profile } = await requireAuth();
  if (!isClient(profile)) redirect(destination(profile));
  return <ClientCheckout initialTime={new Date().toISOString()} />;
}
