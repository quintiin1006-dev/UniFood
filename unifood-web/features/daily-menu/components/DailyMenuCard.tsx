"use client";
import { useId, useState } from "react";
import { ChevronDown, Clock3 } from "lucide-react";
import { CLOSED_NOTICE } from "@/features/client/domain/menu";
import {
  DAILY_MENU_ADD,
  DAILY_MENU_ADD_SOON,
  DAILY_MENU_COLLAPSE,
  DAILY_MENU_COMPOSE,
  DAILY_MENU_LOADING,
  DAILY_MENU_SKIP,
  DAILY_MENU_VIEW,
  dailyMenuProgress,
} from "@/features/shared/messages";
import { formatExtra, formatPrice, missingText } from "../presentation";
import {
  DEFAULT_OPEN,
  EMPTY_SELECTION,
  choose,
  missingChoices,
  selectionProgress,
  toggleAddition,
} from "../state";
import { SKIP, type ClientDailyMenu, type DailyMenuSelection } from "../types";
import type { ClientDailyMenuState } from "../useClientDailyMenu";
import DailyMenuChips from "./DailyMenuChips";
import styles from "./DailyMenu.module.css";

/**
 * Inicio's «Menú del día» block (docs/propuesta-menu-dinamico.md 4.4), fed by
 * useClientDailyMenu. Mount it with key={cafeteriaId} so a new cafeteria starts a fresh
 * selection. Loading shows a skeleton of the folded card; no menu or any failure renders
 * nothing, so Inicio stays as today.
 */
export default function DailyMenuBlock({
  state,
  onAdd,
}: {
  state: ClientDailyMenuState;
  onAdd?: (menu: ClientDailyMenu, selection: DailyMenuSelection) => void;
}) {
  if (state.status === "loading")
    return (
      <div
        className={styles.skeleton}
        role="status"
        aria-label={DAILY_MENU_LOADING}
      />
    );
  if (state.status !== "ok") return null;
  return <DailyMenuCard menu={state.menu} onAdd={onAdd} />;
}

/** The card itself, folded by default (DEFAULT_OPEN); choices survive folding. */
export function DailyMenuCard({
  menu,
  onAdd,
}: {
  menu: ClientDailyMenu;
  /** PR 6 passes the cart action; without it the button stays disabled. */
  onAdd?: (menu: ClientDailyMenu, selection: DailyMenuSelection) => void;
}) {
  const [open, setOpen] = useState(DEFAULT_OPEN);
  const [selection, setSelection] = useState(EMPTY_SELECTION);
  const id = useId();
  const panelId = `${id}-panel`;
  const titleId = `${id}-title`;
  const readOnly = !menu.cafeteria.open;
  const missing = missingChoices(menu, selection);
  const { done, total } = selectionProgress(menu, selection);
  const canAdd = !readOnly && missing.length === 0 && !!onAdd;
  const reason = readOnly
    ? null
    : (missingText(missing) ?? (onAdd ? null : DAILY_MENU_ADD_SOON));

  return (
    <section className={styles.card} aria-labelledby={titleId}>
      <div className={styles.header}>
        {/* Only the dish name from the API: no fixed «Menú del día» label above it. */}
        <h2 id={titleId} className={styles.title}>
          {menu.title}
        </h2>
        <strong className={styles.price}>{formatPrice(menu.price)}</strong>
      </div>
      {readOnly && (
        <p className={styles.closed} role="status">
          <Clock3 size={20} aria-hidden="true" />
          {CLOSED_NOTICE}
        </p>
      )}
      <button
        type="button"
        className={styles.toggle}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        <span>
          {open
            ? DAILY_MENU_COLLAPSE
            : readOnly
              ? DAILY_MENU_VIEW
              : DAILY_MENU_COMPOSE}
        </span>
        {!open && done > 0 && (
          <span className={styles.progress}>
            {dailyMenuProgress(done, total)}
          </span>
        )}
        <ChevronDown className={styles.chevron} size={20} aria-hidden="true" />
      </button>
      <div id={panelId} className={styles.panel} hidden={!open}>
        {menu.categories.map((category) => {
          const labelId = `${id}-${category.id}`;
          return (
            <div key={category.id} className={styles.group}>
              <h3 id={labelId} className={styles.groupTitle}>
                {category.label}
              </h3>
              {category.kind === "SINGLE" ? (
                <DailyMenuChips
                  mode="single"
                  labelledBy={labelId}
                  readOnly={readOnly}
                  chips={[
                    ...category.options.map((option) => ({
                      value: option.id,
                      label: option.label,
                    })),
                    ...(category.canSkip
                      ? [{ value: SKIP, label: DAILY_MENU_SKIP }]
                      : []),
                  ]}
                  selected={
                    selection.choices[category.id]
                      ? [selection.choices[category.id]]
                      : []
                  }
                  onToggle={(value) =>
                    setSelection((current) =>
                      choose(current, category.id, value),
                    )
                  }
                />
              ) : (
                <DailyMenuChips
                  mode="multiple"
                  labelledBy={labelId}
                  readOnly={readOnly}
                  chips={category.additions.map((addition) => ({
                    value: addition.id,
                    label: addition.name,
                    detail: formatExtra(addition.extraPrice),
                  }))}
                  selected={selection.additionIds}
                  onToggle={(value) =>
                    setSelection((current) => toggleAddition(current, value))
                  }
                />
              )}
            </div>
          );
        })}
        <div className={styles.footer}>
          <p className={styles.reason} aria-live="polite">
            {reason}
          </p>
          <button
            type="button"
            className={styles.add}
            disabled={!canAdd}
            onClick={() => canAdd && onAdd?.(menu, selection)}
          >
            {DAILY_MENU_ADD}
          </button>
        </div>
      </div>
    </section>
  );
}
