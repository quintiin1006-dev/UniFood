import type { Viewport } from "next";
import { redirect } from "next/navigation";
import { requireAuth } from "@/features/auth/server/session";
import { sessionTermsState } from "@/features/auth/server/sessionTerms";
import AcceptTermsScreen from "@/features/auth/components/AcceptTermsScreen";
import {
  clientDestination,
  destination,
  isClient,
} from "@/features/auth/validation";

export const metadata = { title: "Antes de seguir | UniFood" };
export const dynamic = "force-dynamic";
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

type Query = { [key: string]: string | string[] | undefined };

export default async function AcceptTermsPage({
  searchParams,
}: {
  searchParams: Promise<Query>;
}) {
  const { profile } = await requireAuth();
  // Only clients accept these terms; everyone else goes to their own panel.
  if (!isClient(profile)) redirect(destination(profile));
  const query = await searchParams;
  const back = clientDestination(
    Array.isArray(query.destino) ? query.destino[0] : query.destino,
  );
  const state = await sessionTermsState();
  if (state === "accepted") redirect(back);
  return <AcceptTermsScreen destination={back} state={state} />;
}
