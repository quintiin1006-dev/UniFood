import { redirect } from "next/navigation";
import { requireAuth } from "@/features/auth/server/session";
import { destination, isClient } from "@/features/auth/validation";
import ClientProfile from "@/features/client/components/ClientProfile";
import { getClientDetails } from "@/features/client/server/profile";

export const metadata = { title: "Mi perfil | UniFood" };

export default async function ClientProfilePage() {
  const { profile, accessToken } = await requireAuth();
  if (!isClient(profile)) redirect(destination(profile));
  const details = await getClientDetails(accessToken);
  return (
    <ClientProfile
      fullName={profile.fullName}
      email={profile.email}
      details={details}
    />
  );
}
