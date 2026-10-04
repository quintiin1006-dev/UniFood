import { redirect } from "next/navigation";
import WorkerDashboard from "@/components/worker/WorkerDashboard";
import { requireAuth } from "@/features/auth/server/session";
import { destination, isWorker } from "@/features/auth/validation";

export const dynamic = "force-dynamic";

export default async function WorkerPage() {
  const { profile } = await requireAuth();
  if (!isWorker(profile)) redirect(destination(profile));
  return <WorkerDashboard />;
}
