import type { Viewport } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireAuth } from "@/features/auth/server/session";
import { sessionTermsState } from "@/features/auth/server/sessionTerms";
import {
  ACCEPT_TERMS_PATH,
  CLIENT_PATH_HEADER,
  clientDestination,
  destination,
  isClient,
} from "@/features/auth/validation";
import ClientShell from "@/features/client/components/ClientShell";
import ClientCartProvider from "@/features/client/components/ClientCartProvider";
import { serverNoticesEnabled } from "@/config/server";

export const dynamic = "force-dynamic";
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
};

export default async function ClientLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const { profile } = await requireAuth();
  if (!isClient(profile)) redirect(destination(profile));
  // Nothing of the client is rendered until the current terms are accepted: a pending or
  // unreadable state leaves here, so no screen of the app appears behind anything.
  const terms = await sessionTermsState();
  if (terms !== "accepted") {
    const asked = clientDestination((await headers()).get(CLIENT_PATH_HEADER));
    redirect(`${ACCEPT_TERMS_PATH}?destino=${encodeURIComponent(asked)}`);
  }
  return (
    <ClientCartProvider key={profile.id} userId={profile.id}>
      {/* Only whether to render the inbox reaches the browser, never the flag itself. */}
      <ClientShell noticesEnabled={serverNoticesEnabled()}>
        {children}
      </ClientShell>
    </ClientCartProvider>
  );
}
