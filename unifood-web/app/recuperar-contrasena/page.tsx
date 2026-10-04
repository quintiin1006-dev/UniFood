import AuthScreen from "@/features/auth/components/AuthScreen";
import { DEFAULT_USERNAME_DOMAIN } from "@/features/auth/validation";

export const metadata = { title: "Recupera tu contraseña | UniFood" };

export default function RecoveryPage() {
  return <AuthScreen initialMode="recover" usernameDomain={process.env.AUTH_USERNAME_DOMAIN || DEFAULT_USERNAME_DOMAIN} />;
}
