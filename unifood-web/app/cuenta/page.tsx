import { redirect } from "next/navigation";
import { requireAuth } from "@/features/auth/server/session";
import { destination, isClient } from "@/features/auth/validation";
import ClientHome from "@/features/client/components/ClientHome";
import { findDemoSite } from "@/features/client/mocks/catalog";
import SiteSelection from "@/features/client/components/SiteSelection";

export const metadata = { title: "Inicio | UniFood" };
export const dynamic = "force-dynamic";

export default async function ClientHomePage({
  searchParams,
}: {
  searchParams: Promise<{ sede?: string | string[] }>;
}) {
  const { profile } = await requireAuth();
  if (!isClient(profile)) redirect(destination(profile));
  const site = findDemoSite((await searchParams).sede);
  return site ? (
    <ClientHome
      fullName={profile.fullName}
      site={site}
      initialTime={new Date().toISOString()}
    />
  ) : (
    <SiteSelection />
  );
}
