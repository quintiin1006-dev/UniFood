"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Mail } from "lucide-react";
import { handRecoveryEmail } from "../recoveryHandoff";
import {
  CONNECTION_FAILED,
  RECOVERY_SEND,
  recoverySendTo,
} from "../../shared/messages";

/**
 * Step 1 of changing the password from «Mi perfil»: the account address is already known, so the
 * only action sends the code. Step 2 (code and new password) opens with the confirmation toast.
 */
export default function SendRecoveryCode({
  email,
  className,
}: {
  email: string;
  className?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const send = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/recover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, entrypoint: "client" }),
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error();
      handRecoveryEmail(email, true);
      router.push("/recuperar-contrasena?entrypoint=client");
    } catch {
      setError(CONNECTION_FAILED);
      setBusy(false);
    }
  };
  return (
    <>
      <p>{recoverySendTo(email)}</p>
      <button
        type="button"
        className={className}
        onClick={send}
        disabled={busy}
        aria-busy={busy || undefined}
      >
        <Mail size={20} aria-hidden="true" />
        {RECOVERY_SEND}
      </button>
      {error && <p role="alert">{error}</p>}
    </>
  );
}
