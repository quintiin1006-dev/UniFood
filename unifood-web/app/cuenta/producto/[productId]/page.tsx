import { notFound, redirect } from "next/navigation";
import { requireAuth } from "@/features/auth/server/session";
import { destination, isClient } from "@/features/auth/validation";
import { cafeteriaHref, findCafeteria } from "@/features/client/domain/context";
import { findProduct } from "@/features/client/domain/menu";
import { loadClientContext } from "@/features/client/server/context";
import { loadCafeteriaMenu } from "@/features/client/server/menu";
import CafeteriaUnavailable from "@/features/client/components/CafeteriaUnavailable";
import ClientProduct from "@/features/client/components/ClientProduct";
import MenuUnavailable from "@/features/client/components/MenuUnavailable";

export const metadata = { title: "Detalle del producto | UniFood" };
export const dynamic = "force-dynamic";

export default async function ClientProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ productId: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { profile } = await requireAuth();
  if (!isClient(profile)) redirect(destination(profile));
  const query = await searchParams;
  const result = await loadClientContext();
  if (result.status !== "ok")
    return <MenuUnavailable title="No pudimos cargar tus cafeterías" />;
  const chosen = findCafeteria(result.context, query.cafeteria);
  if (!chosen)
    redirect(
      typeof query.cafeteria === "string"
        ? cafeteriaHref(query.cafeteria)
        : "/cuenta",
    );
  const menu = await loadCafeteriaMenu(chosen.cafeteria.id);
  if (menu.status === "unavailable") return <CafeteriaUnavailable />;
  if (menu.status !== "ok") return <MenuUnavailable />;
  const product = findProduct(menu.menu, (await params).productId);
  if (!product) notFound();
  return (
    <ClientProduct
      key={product.id}
      siteName={chosen.site.name}
      menu={menu.menu}
      product={product}
    />
  );
}
