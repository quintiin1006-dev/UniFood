"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { handRecoveryEmail } from "../recoveryHandoff";

/**
 * Opens the recovery screen with the account's address already handed over, so the code is sent
 * at once without asking for the address again.
 */
export default function RecoveryCodeLink({
  email,
  className,
  children,
}: {
  email: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link
      className={className}
      href="/recuperar-contrasena?entrypoint=client"
      onClick={() => handRecoveryEmail(email)}
    >
      {children}
    </Link>
  );
}
