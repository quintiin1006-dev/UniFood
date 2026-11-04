import { redirect } from "next/navigation";
import { requireAuth } from "@/features/auth/server/session";
import { destination, isClient } from "@/features/auth/validation";
import ClientMenu from "@/features/client/components/ClientMenu";
import MenuUnavailable from "@/features/client/components/MenuUnavailable";
import { findMenuCategory, findSite } from "@/features/client/domain/menu";
import { loadClientMenu } from "@/features/client/server/menu";

export const metadata = { title: "Menú | UniFood" };

export default async function ClientMenuPage({
  searchParams,
}: {
  searchParams: Promise<{
    sede?: string | string[];
    categoria?: string | string[];
  }>;
}) {
  const { profile } = await requireAuth();
  if (!isClient(profile)) redirect(destination(profile));
  const menu = await loadClientMenu();
  if (menu.unavailable) return <MenuUnavailable />;
  const query = await searchParams;
  const site = findSite(menu, query.sede);
  const category = findMenuCategory(query.categoria);
  if (!site || !category) redirect("/cuenta");
  return (
    <ClientMenu
      key={`${site.id}-${category.id}`}
      site={site}
      category={category}
      initialTime={new Date().toISOString()}
    />
  );
}
