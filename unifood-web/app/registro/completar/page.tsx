import { redirect } from "next/navigation";
import CompleteRegistration from "@/features/auth/components/CompleteRegistration";
import {
  getAuth,
  getPendingRegistration,
} from "@/features/auth/server/session";
import { destination } from "@/features/auth/validation";

export const metadata = { title: "Completa tu registro | UniFood" };
export const dynamic = "force-dynamic";

export default async function CompleteRegistrationPage() {
  const pending = await getPendingRegistration();
  if (!pending) {
    // Finished accounts go to their destination; everyone else to the login.
    const auth = await getAuth();
    redirect(auth ? destination(auth.profile) : "/login");
  }
  // Code rules come from pending_registration(), never from the client.
  return <CompleteRegistration rules={pending} />;
}
