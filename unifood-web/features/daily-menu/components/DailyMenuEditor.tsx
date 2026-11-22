"use client";
import { useRef, useState, type KeyboardEvent } from "react";
import { CircleAlert, Copy, X } from "lucide-react";
import { Notice } from "@/components/ui/Notice";
import { ConnectionNotice } from "@/features/shared/components/ConnectionNotice";
import { panelStyles } from "@/features/worker-ui/components/PanelHeader";
import { AvailabilitySwitch } from "@/features/availability/components/AvailabilitySwitch";
import availability from "@/features/availability/components/Availability.module.css";
import {
  DAILY_MENU_COPY,
  DAILY_MENU_DUPLICATE,
  DAILY_MENU_EDITOR_ADDITIONS,
  DAILY_MENU_EDITOR_DRAFT,
  DAILY_MENU_EDITOR_HINT,
  DAILY_MENU_EDITOR_OFFLINE,
  DAILY_MENU_EDITOR_PLACEHOLDER,
  DAILY_MENU_EDITOR_PUBLISHED,
  DAILY_MENU_EDITOR_SAVING,
  DAILY_MENU_EDITOR_TITLE,
  DAILY_MENU_EDITOR_UNAVAILABLE,
  DAILY_MENU_LOADING,
  DAILY_MENU_MAX_OPTIONS,
  DAILY_MENU_NO_EXTRA_PRICE,
  DAILY_MENU_PUBLISH,
  DAILY_MENU_TOO_LONG,
  DAILY_MENU_UNPUBLISH,
  dailyMenuRemoveOption,
} from "@/features/shared/messages";
import {
  commitDraft,
  overLimit,
  publishCheck,
  removeOption,
  type ChipError,
} from "../editor";
import { formatExtra, formatPrice } from "../presentation";
import type { WorkerDailyMenuCategory } from "../types";
import type { DailyMenuEditorState } from "../useDailyMenu";
import styles from "./DailyMenuEditor.module.css";

const CHIP_ERRORS: Record<ChipError, string> = {
  duplicate: DAILY_MENU_DUPLICATE,
  max: DAILY_MENU_MAX_OPTIONS,
  tooLong: DAILY_MENU_TOO_LONG,
};

/**
 * «Menú del día» inside Disponibilidad (docs/propuesta-menu-dinamico.md 4.3): sections of the
 * same glass panel, at the top, in the place of the catalogue's «Del día». Hidden with the flag
 * off or without a daily menu for this worker (the BFF answers 404 and nothing is drawn). The
 * panel owns the state (useDailyMenu) because it also decides whether «Del día» is drawn.
 */
export function DailyMenuEditor({ state }: { state: DailyMenuEditorState }) {
  // What the worker is typing per category; a read or a conflict never clears it.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, ChipError | null>>({});
  const [showReasons, setShowReasons] = useState(false);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});

  if (state.status === "hidden") return null;
  if (state.status === "loading")
    return (
      <div
        className={`${panelStyles.section} ${styles.loading}`}
        role="status"
        aria-label={DAILY_MENU_LOADING}
      />
    );
  if (!state.day)
    return (
      <div className={panelStyles.section}>
        <ConnectionNotice
          surface="glass"
          tone="error"
          onRetry={() => void state.refresh()}
        >
          {DAILY_MENU_EDITOR_UNAVAILABLE}
        </ConnectionNotice>
      </div>
    );

  const day = state.day;
  const locked = state.offline || state.busyAction !== null;
  const red = (category: WorkerDailyMenuCategory) =>
    overLimit(
      category.options.map(({ label }) => label),
      drafts[category.id] ?? "",
    );
  const anyRed = state.categories.some(red);
  const check = publishCheck(day, state.categories, anyRed);

  function setDraft(id: string, value: string) {
    setDrafts((current) => ({ ...current, [id]: value }));
  }

  function commit(
    category: WorkerDailyMenuCategory,
    text: string,
    final: boolean,
  ) {
    const options = category.options.map(({ label }) => label);
    const result = commitDraft(options, text, final);
    setDraft(category.id, result.rest);
    setErrors((current) => ({ ...current, [category.id]: result.error }));
    if (result.error) inputs.current[category.id]?.focus();
    if (result.options.length !== options.length)
      void state.setOptions(category.id, result.options);
  }

  function onKeyDown(
    event: KeyboardEvent<HTMLInputElement>,
    category: WorkerDailyMenuCategory,
  ) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    commit(category, event.currentTarget.value, true);
  }

  return (
    <section
      className={styles.editor}
      aria-labelledby="daily-menu-editor-title"
      aria-busy={state.pending > 0}
    >
      <div className={`${panelStyles.section} ${styles.head}`}>
        <div className={styles.heading}>
          <h3 id="daily-menu-editor-title" className={styles.title}>
            {DAILY_MENU_EDITOR_TITLE}
          </h3>
          <p className={styles.meta}>
            {day.title && <span>{day.title}</span>}
            {day.price && <span>{formatPrice(Number(day.price))}</span>}
            <span className={styles.badge} data-published={day.published}>
              {day.published
                ? DAILY_MENU_EDITOR_PUBLISHED
                : DAILY_MENU_EDITOR_DRAFT}
            </span>
          </p>
        </div>
        <button
          type="button"
          className={availability.refresh}
          disabled={locked}
          aria-busy={state.busyAction === "copy-yesterday" || undefined}
          onClick={() => void state.runAction("copy-yesterday")}
        >
          <Copy size={20} aria-hidden="true" />
          <span>{DAILY_MENU_COPY}</span>
        </button>
      </div>

      {state.offline && (
        <div className={panelStyles.section}>
          <ConnectionNotice surface="glass" retrying>
            {DAILY_MENU_EDITOR_OFFLINE}
          </ConnectionNotice>
        </div>
      )}
      {state.notice && (
        <div className={panelStyles.section}>
          <Notice tone={state.notice.tone}>{state.notice.text}</Notice>
        </div>
      )}

      {state.categories.map((category) => {
        const inputId = `daily-menu-${category.id}`;
        const errorId = `${inputId}-error`;
        const hintId = `${inputId}-hint`;
        const isRed = red(category);
        const error = isRed ? "tooLong" : errors[category.id];
        return (
          <div
            key={category.id}
            className={`${panelStyles.section} ${styles.category}`}
          >
            <label htmlFor={inputId} className={styles.label}>
              {category.label}
            </label>
            <div className={styles.box} data-invalid={isRed || undefined}>
              {category.options.length > 0 && (
                <ul className={styles.chips}>
                  {category.options.map((option, index) => (
                    <li key={`${option.id}-${index}`} className={styles.chip}>
                      <span>{option.label}</span>
                      <button
                        type="button"
                        className={styles.chipRemove}
                        aria-label={dailyMenuRemoveOption(option.label)}
                        disabled={locked}
                        onClick={() =>
                          void state.setOptions(
                            category.id,
                            removeOption(
                              category.options.map(({ label }) => label),
                              index,
                            ),
                          )
                        }
                      >
                        <X size={20} aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <input
                id={inputId}
                ref={(element) => {
                  inputs.current[category.id] = element;
                }}
                className={styles.input}
                type="text"
                autoComplete="off"
                enterKeyHint="done"
                placeholder={DAILY_MENU_EDITOR_PLACEHOLDER}
                value={drafts[category.id] ?? ""}
                disabled={locked}
                aria-invalid={isRed || undefined}
                aria-describedby={error ? `${errorId} ${hintId}` : hintId}
                onChange={(event) => {
                  const value = event.target.value;
                  setErrors((current) => ({ ...current, [category.id]: null }));
                  if (value.includes(",")) commit(category, value, false);
                  else setDraft(category.id, value);
                }}
                onKeyDown={(event) => onKeyDown(event, category)}
              />
            </div>
            <p id={hintId} className={styles.hint}>
              {DAILY_MENU_EDITOR_HINT}
            </p>
            {error && (
              <p id={errorId} className={styles.error} role="alert">
                <CircleAlert size={20} aria-hidden="true" />
                <span>{CHIP_ERRORS[error]}</span>
              </p>
            )}
          </div>
        );
      })}

      {state.additions.length > 0 && (
        <div className={`${panelStyles.section} ${styles.category}`}>
          <h4 id="daily-menu-additions" className={styles.label}>
            {DAILY_MENU_EDITOR_ADDITIONS}
          </h4>
          <ul
            className={styles.additions}
            aria-labelledby="daily-menu-additions"
          >
            {state.additions.map((addition) => {
              const extra = addition.extraPrice
                ? formatExtra(Number(addition.extraPrice))
                : DAILY_MENU_NO_EXTRA_PRICE;
              return (
                <li key={addition.id} className={styles.addition}>
                  <span className={styles.additionName}>{addition.name}</span>
                  <AvailabilitySwitch
                    checked={addition.available}
                    // Without a price an addition cannot be switched on.
                    disabled={
                      locked || (!addition.available && !addition.extraPrice)
                    }
                    label={`${addition.name}, ${extra}`}
                    text={extra}
                    onChange={(value) =>
                      void state.setAddition(addition.id, value)
                    }
                  />
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className={`${panelStyles.section} ${styles.foot}`}>
        <p className={styles.status} role="status" aria-live="polite">
          {state.pending > 0 ? DAILY_MENU_EDITOR_SAVING : ""}
        </p>
        {(showReasons || check.disabled) && check.reasons.length > 0 && (
          <ul
            id="daily-menu-reasons"
            className={styles.reasons}
            aria-live="polite"
          >
            {check.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        )}
        {day.published ? (
          <button
            type="button"
            className={styles.secondary}
            disabled={locked}
            aria-busy={state.busyAction === "unpublish" || undefined}
            onClick={() => void state.runAction("unpublish")}
          >
            {DAILY_MENU_UNPUBLISH}
          </button>
        ) : (
          <button
            type="button"
            className={styles.primary}
            disabled={locked || check.disabled}
            aria-describedby={
              check.reasons.length ? "daily-menu-reasons" : undefined
            }
            aria-busy={state.busyAction === "publish" || undefined}
            onClick={() => {
              // Missing options: the reasons show and nothing is sent.
              if (check.reasons.length) setShowReasons(true);
              else void state.runAction("publish");
            }}
          >
            {DAILY_MENU_PUBLISH}
          </button>
        )}
      </div>
    </section>
  );
}
