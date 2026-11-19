import { redirect } from "next/navigation";
import { requireAuth } from "@/features/auth/server/session";
import { destination, isClient } from "@/features/auth/validation";
import {
  allCafeterias,
  resolveSelection,
} from "@/features/client/domain/context";
import { loadClientContext } from "@/features/client/server/context";
import { loadCafeteriaMenu } from "@/features/client/server/menu";
import CafeteriaUnavailable from "@/features/client/components/CafeteriaUnavailable";
import ClientHome from "@/features/client/components/ClientHome";
import ConnectionError from "@/features/client/components/ConnectionError";
import NoCafeterias from "@/features/client/components/NoCafeterias";
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
  // Two different things: the server did not answer, or it answered with nothing.
  if (result.status !== "ok") return <ConnectionError />;
  const { context } = result;
  if (allCafeterias(context).length === 0) return <NoCafeterias />;
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
      siteName={selection.site.name}
      menu={menu.menu}
    />
  );
}
