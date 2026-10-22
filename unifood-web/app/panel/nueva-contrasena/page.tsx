import { authConfig } from "@/features/auth/server/config";
import { PanelRecoveryScreen } from "@/features/panel-recovery/PanelRecoveryScreen";
import { publicRecoveryConfig } from "@/features/panel-recovery/config";

export const metadata = {
  title: "Crea una nueva contraseña | UniFood",
  referrer: "no-referrer",
};
export const dynamic = "force-dynamic";

export default function NewPasswordPage() {
  return (
    <PanelRecoveryScreen
      mode="password"
      config={publicRecoveryConfig(authConfig())}
    />
  );
}
