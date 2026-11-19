import { redirect } from "next/navigation";
import { requireAuth } from "@/features/auth/server/session";
import { destination, isClient } from "@/features/auth/validation";
import ClientCheckout from "@/features/client/components/ClientCheckout";

export const metadata = { title: "Carrito | UniFood" };
export const dynamic = "force-dynamic";

/** Cart and confirmation are one screen: lines, pickup time, note and «Confirmar pedido». */
export default async function ClientCartPage() {
  const { profile } = await requireAuth();
  if (!isClient(profile)) redirect(destination(profile));
  return <ClientCheckout initialTime={new Date().toISOString()} />;
}
