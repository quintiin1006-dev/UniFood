"use client";
import styles from "./Availability.module.css";

export function AvailabilitySwitch({
  checked,
  disabled,
  label,
  text,
  descriptionId,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  label: string;
  text: string;
  descriptionId?: string;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-describedby={descriptionId}
      disabled={disabled}
      className={styles.switch}
      onClick={() => onChange(!checked)}
    >
      <span>{text}</span>
      <span className={styles.track} aria-hidden="true">
        <span className={styles.thumb} />
      </span>
    </button>
  );
}
