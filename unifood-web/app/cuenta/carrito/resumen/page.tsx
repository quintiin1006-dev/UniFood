import { redirect } from "next/navigation";
import { requireAuth } from "@/features/auth/server/session";
import { destination, isClient } from "@/features/auth/validation";

// The summary is now part of the cart screen; the old address keeps working for clients.
export default async function ClientCheckoutRedirectPage() {
  const { profile } = await requireAuth();
  if (!isClient(profile)) redirect(destination(profile));
  redirect("/cuenta/carrito");
}
