import { redirect } from "next/navigation";
import { requireAuth } from "@/features/auth/server/session";
import { destination, isClient } from "@/features/auth/validation";
import ClientCart from "@/features/client/components/ClientCart";
export const metadata = { title: "Carrito | UniFood" };
export default async function ClientCartPage() {
  const { profile } = await requireAuth();
  if (!isClient(profile)) redirect(destination(profile));
  return <ClientCart initialTime={new Date().toISOString()} />;
}
