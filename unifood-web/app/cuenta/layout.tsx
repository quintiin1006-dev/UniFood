import type { Viewport } from "next";
import { redirect } from "next/navigation";
import { requireAuth } from "@/features/auth/server/session";
import { currentTermsAccepted } from "@/features/auth/server/terms";
import { destination, isClient } from "@/features/auth/validation";
import ClientShell from "@/features/client/components/ClientShell";
import ClientCartProvider from "@/features/client/components/ClientCartProvider";
import TermsGate from "@/features/client/components/TermsGate";

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
  // Before the first screen of the client: anyone who has not accepted the current terms
  // accepts them here once, and the dialog is gone for good after that.
  const termsAccepted = await currentTermsAccepted();
  return (
    <ClientCartProvider key={profile.id} userId={profile.id}>
      <ClientShell>{children}</ClientShell>
      {!termsAccepted && <TermsGate />}
    </ClientCartProvider>
  );
}
