import { redirect } from "next/navigation";
import { requireAuth } from "@/features/auth/server/session";
import { destination, isClient } from "@/features/auth/validation";
import ClientPassword from "@/features/client/components/ClientPassword";

export const metadata = { title: "Cambiar contraseña | UniFood" };

export default async function ClientPasswordPage() {
  const { profile } = await requireAuth();
  if (!isClient(profile)) redirect(destination(profile));
  return <ClientPassword />;
}
