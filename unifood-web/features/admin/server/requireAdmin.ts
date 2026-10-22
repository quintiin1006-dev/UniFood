import "server-only";
import { redirect } from "next/navigation";
import { requireAuth } from "@/features/auth/server/session";
import { destination, isAdmin } from "@/features/auth/validation";

export async function requireAdmin() {
  const auth = await requireAuth("panel");
  if (!isAdmin(auth.profile)) redirect(destination(auth.profile));
  return auth;
}
