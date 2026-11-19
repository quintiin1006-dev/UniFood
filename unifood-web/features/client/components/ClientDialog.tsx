"use client";

import { useEffect, useId, useRef } from "react";
import styles from "./ClientShopping.module.css";

export default function ClientDialog({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current;
    element?.showModal();
    return () => {
      element?.close();
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      {/* C1: the title takes the first focus, so no button opens with a focus ring. */}
      <h2 id={titleId} tabIndex={-1} autoFocus>
        {title}
      </h2>
      {children}
    </dialog>
  );
}
