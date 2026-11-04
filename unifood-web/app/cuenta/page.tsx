import { redirect } from "next/navigation";
import { requireAuth } from "@/features/auth/server/session";
import { destination, isClient } from "@/features/auth/validation";
import ClientHome from "@/features/client/components/ClientHome";
import MenuUnavailable from "@/features/client/components/MenuUnavailable";
import SiteSelection from "@/features/client/components/SiteSelection";
import { findSite } from "@/features/client/domain/menu";
import { loadClientMenu } from "@/features/client/server/menu";

export const metadata = { title: "Inicio | UniFood" };
export const dynamic = "force-dynamic";

export default async function ClientHomePage({
  searchParams,
}: {
  searchParams: Promise<{ sede?: string | string[] }>;
}) {
  const { profile } = await requireAuth();
  if (!isClient(profile)) redirect(destination(profile));
  const menu = await loadClientMenu();
  if (menu.unavailable) return <MenuUnavailable />;
  const site = findSite(menu, (await searchParams).sede);
  return site ? (
    <ClientHome
      fullName={profile.fullName}
      site={site}
      initialTime={new Date().toISOString()}
    />
  ) : (
    <SiteSelection sites={menu.sites} />
  );
}
