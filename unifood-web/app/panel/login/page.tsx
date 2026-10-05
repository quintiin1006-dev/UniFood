import { redirect } from "next/navigation";
import AuthScreen from "@/features/auth/components/AuthScreen";
import { getAuth } from "@/features/auth/server/session";
import {
  DEFAULT_USERNAME_DOMAIN,
  destination,
} from "@/features/auth/validation";

export const metadata = { title: "Acceso al panel | UniFood" };

export default async function PanelLoginPage() {
  const auth = await getAuth();
  if (auth) redirect(destination(auth.profile));
  return (
    <AuthScreen
      initialMode="login"
      entrypoint="panel"
      usernameDomain={
        process.env.AUTH_USERNAME_DOMAIN || DEFAULT_USERNAME_DOMAIN
      }
    />
  );
}
