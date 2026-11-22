"use client";
import { useRef, type KeyboardEvent } from "react";
import styles from "./DailyMenu.module.css";

export type DailyMenuChip = {
  value: string;
  label: string;
  /** Second line inside the chip, such as «+ $ 2.000». */
  detail?: string;
};

/**
 * Generic chips (reused by the worker editor): "single" is a radiogroup with roving focus and
 * arrow keys, "multiple" a set of checkboxes. `readOnly` keeps them focusable but inert.
 */
export default function DailyMenuChips({
  mode,
  labelledBy,
  chips,
  selected,
  onToggle,
  readOnly = false,
}: {
  mode: "single" | "multiple";
  labelledBy: string;
  chips: DailyMenuChip[];
  selected: string[];
  onToggle: (value: string) => void;
  readOnly?: boolean;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const single = mode === "single";
  const focusIndex = Math.max(
    0,
    chips.findIndex(({ value }) => selected.includes(value)),
  );

  function onKeyDown(event: KeyboardEvent, index: number) {
    if (!single) return;
    const step =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (!step) return;
    event.preventDefault();
    const next = (index + step + chips.length) % chips.length;
    refs.current[next]?.focus();
    if (!readOnly) onToggle(chips[next].value);
  }

  return (
    <div
      className={styles.chips}
      role={single ? "radiogroup" : "group"}
      aria-labelledby={labelledBy}
      aria-readonly={single && readOnly ? true : undefined}
    >
      {chips.map((chip, index) => {
        const checked = selected.includes(chip.value);
        return (
          <button
            key={chip.value}
            ref={(element) => {
              refs.current[index] = element;
            }}
            type="button"
            role={single ? "radio" : "checkbox"}
            aria-checked={checked}
            aria-disabled={readOnly || undefined}
            tabIndex={single ? (index === focusIndex ? 0 : -1) : 0}
            className={styles.chip}
            onClick={() => !readOnly && onToggle(chip.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            <span>{chip.label}</span>
            {chip.detail && (
              <span className={styles.chipDetail}>{chip.detail}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
