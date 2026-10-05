import AuthScreen from "@/features/auth/components/AuthScreen";
import {
  DEFAULT_USERNAME_DOMAIN,
  parseEntrypoint,
} from "@/features/auth/validation";
import { notFound } from "next/navigation";

export const metadata = { title: "Recupera tu contraseña | UniFood" };

export default async function RecoveryPage({
  searchParams,
}: {
  searchParams: Promise<{ entrypoint?: string | string[] }>;
}) {
  const entrypoint = parseEntrypoint((await searchParams).entrypoint);
  if (!entrypoint) notFound();
  // Do not redirect the temporary session needed by OTP/reset.
  return (
    <AuthScreen
      initialMode="recover"
      entrypoint={entrypoint}
      usernameDomain={
        process.env.AUTH_USERNAME_DOMAIN || DEFAULT_USERNAME_DOMAIN
      }
    />
  );
}
