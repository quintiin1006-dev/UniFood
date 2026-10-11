import { redirect } from "next/navigation";
import { requireAuth } from "@/features/auth/server/session";
import { destination, isClient } from "@/features/auth/validation";
import ClientMenu from "@/features/client/components/ClientMenu";
import {
  findDemoSite,
  findDemoCategory,
} from "@/features/client/mocks/catalog";
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
  const query = await searchParams;
  const site = findDemoSite(query.sede);
  const category = findDemoCategory(query.categoria);
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
