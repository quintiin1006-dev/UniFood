import AuthScreen from "@/features/auth/components/AuthScreen";
import {
  DEFAULT_USERNAME_DOMAIN,
  REGISTRATION_COMPLETE_PATH,
} from "@/features/auth/validation";
import { destination } from "@/features/auth/validation";
import {
  getAuth,
  getPendingRegistration,
} from "@/features/auth/server/session";
import { redirect } from "next/navigation";

export const metadata = { title: "Iniciar sesión | UniFood" };

export default async function LoginPage() {
  const auth = await getAuth();
  if (auth) redirect(destination(auth.profile));
  if (await getPendingRegistration()) redirect(REGISTRATION_COMPLETE_PATH);
  return (
    <AuthScreen
      initialMode="login"
      entrypoint="client"
      usernameDomain={
        process.env.AUTH_USERNAME_DOMAIN || DEFAULT_USERNAME_DOMAIN
      }
    />
  );
}
