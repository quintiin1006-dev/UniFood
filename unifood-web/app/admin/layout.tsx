import type { ReactNode } from "react";
import { requireAdmin } from "@/features/admin/server/requireAdmin";
import { AdminShell } from "@/features/admin/components/AdminShell";

export const metadata = { title: "Administración | UniFood" };
export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  await requireAdmin();
  return <AdminShell>{children}</AdminShell>;
}
