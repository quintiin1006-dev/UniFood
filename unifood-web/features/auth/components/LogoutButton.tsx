"use client";

import { useState } from "react";
import { LogOut } from "lucide-react";
import { dropPushBeforeSignOut } from "@/features/push/signOut";
import { clearSessionStores } from "@/features/shared/sessionStore";
import { loginPath, type AuthEntrypoint } from "../validation";
import { ICON_MIN_20 } from "@/components/ui/Icon";

export default function LogoutButton({
  className,
  entrypoint,
}: {
  className?: string;
  entrypoint: AuthEntrypoint;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function logout() {
    setBusy(true);
    setError("");
    try {
      // This browser stops receiving the account's notices before the session ends.
      await dropPushBeforeSignOut(
        entrypoint === "client" ? "client" : "worker",
      );
      const response = await fetch("/api/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entrypoint }),
      });
      if (!response.ok)
        throw new Error("No se pudo cerrar la sesión. Inténtalo de nuevo.");
      window.dispatchEvent(new Event("unifood:logout"));
      clearSessionStores();
      window.location.replace(loginPath(entrypoint));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "No se pudo cerrar la sesión.",
      );
      setBusy(false);
    }
  }
  return (
    <div>
      <button
        className={className}
        type="button"
        onClick={logout}
        disabled={busy}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          cursor: "pointer",
        }}
      >
        <LogOut size={20} style={ICON_MIN_20} />
        {busy ? "Cerrando sesión…" : "Cerrar sesión"}
      </button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
