"use client";
import ClientDialog from "./ClientDialog";
import styles from "./ClientShopping.module.css";

export default function ConfirmDialog({
  title,
  children,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  children: React.ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <ClientDialog title={title} onClose={onCancel}>
      <div>{children}</div>
      <div className={styles.dialogActions}>
        <button
          type="button"
          className={styles.secondaryButton}
          onClick={onCancel}
          autoFocus
        >
          Conservar carrito
        </button>
        <button
          type="button"
          className={styles.primaryButton}
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
      </div>
    </ClientDialog>
  );
}
