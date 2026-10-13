import type { Viewport } from "next";
import { redirect } from "next/navigation";
import { requireAuth } from "@/features/auth/server/session";
import { destination, isClient } from "@/features/auth/validation";
import ClientShell from "@/features/client/components/ClientShell";
import ClientCartProvider from "@/features/client/components/ClientCartProvider";

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
  return (
    <ClientCartProvider key={profile.id} userId={profile.id}>
      <ClientShell>{children}</ClientShell>
    </ClientCartProvider>
  );
}
