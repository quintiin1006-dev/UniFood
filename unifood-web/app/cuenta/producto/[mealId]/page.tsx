import { notFound, redirect } from "next/navigation";
import { requireAuth } from "@/features/auth/server/session";
import { destination, isClient } from "@/features/auth/validation";
import ClientProduct from "@/features/client/components/ClientProduct";
import MenuUnavailable from "@/features/client/components/MenuUnavailable";
import { findSite } from "@/features/client/domain/menu";
import { loadClientMenu } from "@/features/client/server/menu";

export const metadata = { title: "Detalle del plato | UniFood" };

export default async function ClientProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ mealId: string }>;
  searchParams: Promise<{ sede?: string | string[] }>;
}) {
  const { profile } = await requireAuth();
  if (!isClient(profile)) redirect(destination(profile));
  const menu = await loadClientMenu();
  if (menu.unavailable) return <MenuUnavailable />;
  const site = findSite(menu, (await searchParams).sede);
  if (!site) redirect("/cuenta");
  const { mealId } = await params;
  const meal = site.meals.find((item) => item.id === mealId);
  if (!meal) notFound();
  return (
    <ClientProduct
      key={`${site.id}-${meal.id}`}
      site={site}
      meal={meal}
      initialTime={new Date().toISOString()}
    />
  );
}
