"use client";

import { useState } from "react";
import { LogOut } from "lucide-react";
import { loginPath, type AuthEntrypoint } from "../validation";

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
      const response = await fetch("/api/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entrypoint }),
      });
      if (!response.ok)
        throw new Error("No se pudo cerrar la sesión. Inténtalo de nuevo.");
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
        <LogOut size={17} />
        {busy ? "Cerrando sesión…" : "Cerrar sesión"}
      </button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
