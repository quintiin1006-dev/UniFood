"use client";
import { useState, type InputHTMLAttributes, type ReactNode } from "react";
import { Eye, EyeOff } from "lucide-react";
import styles from "./AuthScreen.module.css";

export function Field({
  icon,
  label,
  password = false,
  language,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  icon: ReactNode;
  label: string;
  password?: boolean;
  language: "es" | "en";
}) {
  const [visible, setVisible] = useState(false);
  return (
    <label className={styles.field}>
      {icon}
      <span className={styles.srOnly}>{label}</span>
      <input
        {...props}
        aria-label={label}
        placeholder={label}
        type={password ? (visible ? "text" : "password") : props.type || "text"}
      />
      {password && (
        <button
          type="button"
          disabled={props.disabled}
          onClick={() => setVisible((current) => !current)}
          aria-label={
            visible
              ? language === "es"
                ? "Ocultar contraseña"
                : "Hide password"
              : language === "es"
                ? "Mostrar contraseña"
                : "Show password"
          }
          aria-pressed={visible}
        >
          {visible ? <Eye size={21} /> : <EyeOff size={21} />}
        </button>
      )}
    </label>
  );
}
