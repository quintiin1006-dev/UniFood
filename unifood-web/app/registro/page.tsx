import AuthScreen from "@/features/auth/components/AuthScreen";
import { DEFAULT_USERNAME_DOMAIN } from "@/features/auth/validation";

export const metadata = { title: "Crea tu cuenta | UniFood" };

export default function RegisterPage() {
  return <AuthScreen initialMode="register" usernameDomain={process.env.AUTH_USERNAME_DOMAIN || DEFAULT_USERNAME_DOMAIN} />;
}
