import { redirect } from "next/navigation";
import { requireAuth } from "@/features/auth/server/session";
import { destination, isClient } from "@/features/auth/validation";
import { resolveSelection } from "@/features/client/domain/context";
import { loadClientContext } from "@/features/client/server/context";
import { loadCafeteriaMenu } from "@/features/client/server/menu";
import CafeteriaUnavailable from "@/features/client/components/CafeteriaUnavailable";
import ClientHome from "@/features/client/components/ClientHome";
import MenuUnavailable from "@/features/client/components/MenuUnavailable";
import SiteSelection from "@/features/client/components/SiteSelection";

export const metadata = { title: "Inicio | UniFood" };
export const dynamic = "force-dynamic";

type Query = { [key: string]: string | string[] | undefined };

export default async function ClientHomePage({
  searchParams,
}: {
  searchParams: Promise<Query>;
}) {
  const { profile } = await requireAuth();
  if (!isClient(profile)) redirect(destination(profile));
  const result = await loadClientContext();
  if (result.status !== "ok")
    return <MenuUnavailable title="No pudimos cargar tus cafeterías" />;
  const { context } = result;
  const selection = resolveSelection(context, await searchParams);
  if (selection.view !== "home")
    return (
      <SiteSelection
        ownerId={profile.id}
        context={context}
        selection={selection}
      />
    );
  const menu = await loadCafeteriaMenu(selection.cafeteria.id);
  if (menu.status === "unavailable") return <CafeteriaUnavailable />;
  if (menu.status !== "ok") return <MenuUnavailable />;
  return (
    <ClientHome
      ownerId={profile.id}
      fullName={profile.fullName ?? context.fullName}
      siteName={selection.site.name}
      menu={menu.menu}
    />
  );
}
