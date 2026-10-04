import AuthScreen from "@/features/auth/components/AuthScreen";
import { DEFAULT_USERNAME_DOMAIN } from "@/features/auth/validation";

export const metadata = { title: "Iniciar sesión | UniFood" };

export default function LoginPage() {
  return <AuthScreen initialMode="login" usernameDomain={process.env.AUTH_USERNAME_DOMAIN || DEFAULT_USERNAME_DOMAIN} />;
}
