"use client";

import { useState } from "react";
import { LogOut } from "lucide-react";

export default function LogoutButton({ className }: { className?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function logout() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/auth/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (!response.ok) throw new Error("No se pudo cerrar la sesión. Inténtalo de nuevo.");
      window.location.replace("/login");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cerrar la sesión.");
      setBusy(false);
    }
  }
  return <div>
    <button className={className} type="button" onClick={logout} disabled={busy} style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer" }}><LogOut size={17} />{busy ? "Cerrando sesión…" : "Cerrar sesión"}</button>
    {error && <p role="alert">{error}</p>}
  </div>;
}
