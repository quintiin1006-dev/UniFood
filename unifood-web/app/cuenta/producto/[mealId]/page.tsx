import { notFound, redirect } from "next/navigation";
import { requireAuth } from "@/features/auth/server/session";
import { destination, isClient } from "@/features/auth/validation";
import { findDemoSite, getSiteMeals } from "@/features/client/mocks/catalog";
import ClientProduct from "@/features/client/components/ClientProduct";

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
  const site = findDemoSite((await searchParams).sede);
  if (!site) redirect("/cuenta");
  const { mealId } = await params;
  const meal = getSiteMeals(site).find((item) => item.id === mealId);
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
