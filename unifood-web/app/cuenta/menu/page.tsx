import { redirect } from "next/navigation";
import { requireAuth } from "@/features/auth/server/session";
import { destination, isClient } from "@/features/auth/validation";
import { cafeteriaHref, findCafeteria } from "@/features/client/domain/context";
import { findCategoryBySlug, menuHref } from "@/features/client/domain/menu";
import { loadClientContext } from "@/features/client/server/context";
import { loadCafeteriaMenu } from "@/features/client/server/menu";
import CafeteriaUnavailable from "@/features/client/components/CafeteriaUnavailable";
import ClientMenu from "@/features/client/components/ClientMenu";
import MenuUnavailable from "@/features/client/components/MenuUnavailable";

export const metadata = { title: "Menú | UniFood" };
export const dynamic = "force-dynamic";

export default async function ClientMenuPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { profile } = await requireAuth();
  if (!isClient(profile)) redirect(destination(profile));
  const query = await searchParams;
  const result = await loadClientContext();
  if (result.status !== "ok")
    return <MenuUnavailable title="No pudimos cargar tus cafeterías" />;
  // The cafeteria is validated against the context on every request (§4).
  const chosen = findCafeteria(result.context, query.cafeteria);
  if (!chosen)
    redirect(
      typeof query.cafeteria === "string"
        ? cafeteriaHref(query.cafeteria)
        : "/cuenta",
    );
  const category = findCategoryBySlug(query.categoria);
  if (query.categoria !== undefined && !category)
    redirect(menuHref(chosen.cafeteria.id));
  const menu = await loadCafeteriaMenu(chosen.cafeteria.id);
  if (menu.status === "unavailable") return <CafeteriaUnavailable />;
  if (menu.status !== "ok") return <MenuUnavailable />;
  return (
    <ClientMenu
      key={`${chosen.cafeteria.id}-${category?.id ?? "todo"}`}
      siteName={chosen.site.name}
      menu={menu.menu}
      categoryId={category?.id ?? null}
    />
  );
}
