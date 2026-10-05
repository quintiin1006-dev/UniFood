import AuthScreen from "@/features/auth/components/AuthScreen";
import { DEFAULT_USERNAME_DOMAIN } from "@/features/auth/validation";
import { destination } from "@/features/auth/validation";
import { getAuth } from "@/features/auth/server/session";
import { redirect } from "next/navigation";

export const metadata = { title: "Iniciar sesión | UniFood" };

export default async function LoginPage() {
  const auth = await getAuth();
  if (auth) redirect(destination(auth.profile));
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
