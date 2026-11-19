"use client";
import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown, Store } from "lucide-react";
import type { ContextSite } from "../types";
import {
  CAFETERIA_PICKER_LIST,
  CAFETERIA_STATUS_CLOSED,
  CAFETERIA_STATUS_OPEN,
  cafeteriaPickerLabel,
} from "../../shared/messages";
import CafeteriaLink from "./CafeteriaLink";
import styles from "./HomeSections.module.css";

/**
 * C2 (jj/cliente-ajustes): the current cafeteria on Inicio opens the list of the available ones
 * right there, without leaving the page. Choosing one goes through CafeteriaLink, so a cart from
 * another cafeteria still asks before it is emptied.
 */
export default function CafeteriaPicker({
  siteName,
  cafeteria,
  sites,
}: {
  siteName: string;
  cafeteria: { id: string; name: string; open: boolean };
  sites: ContextSite[];
}) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const root = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const status = cafeteria.open
    ? CAFETERIA_STATUS_OPEN
    : CAFETERIA_STATUS_CLOSED;

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      toggle.current?.focus();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const multipleSites = sites.length > 1;
  return (
    <div className={styles.picker} ref={root}>
      <button
        ref={toggle}
        type="button"
        className={styles.selector}
        aria-expanded={open}
        aria-controls={listId}
        aria-label={cafeteriaPickerLabel(cafeteria.name, siteName, status)}
        onClick={() => setOpen((value) => !value)}
      >
        <Store size={20} strokeWidth={1.8} aria-hidden="true" />
        <strong>{cafeteria.name}</strong>
        <span className={styles.selectorSite}>{siteName}</span>
        <span className={styles.selectorStatus} data-open={cafeteria.open}>
          {status}
        </span>
        <ChevronDown
          size={20}
          aria-hidden="true"
          className={styles.pickerChevron}
        />
      </button>
      <div
        id={listId}
        className={styles.pickerPanel}
        hidden={!open}
        role="region"
        aria-label={CAFETERIA_PICKER_LIST}
      >
        {sites.map((site) => (
          <div key={site.id}>
            {multipleSites && <p className={styles.pickerSite}>{site.name}</p>}
            <ul aria-label={site.name}>
              {site.cafeterias.map((option) => {
                const current = option.id === cafeteria.id;
                const content = (
                  <>
                    <span className={styles.pickerName}>{option.name}</span>
                    <span
                      className={styles.selectorStatus}
                      data-open={option.open}
                    >
                      {option.open
                        ? CAFETERIA_STATUS_OPEN
                        : CAFETERIA_STATUS_CLOSED}
                    </span>
                    {current && (
                      <Check size={20} aria-hidden="true" strokeWidth={2.2} />
                    )}
                  </>
                );
                return (
                  <li key={option.id}>
                    {current ? (
                      <button
                        type="button"
                        className={styles.pickerOption}
                        aria-current="true"
                        onClick={() => setOpen(false)}
                      >
                        {content}
                      </button>
                    ) : (
                      <CafeteriaLink
                        className={styles.pickerOption}
                        cafeteriaId={option.id}
                      >
                        {content}
                      </CafeteriaLink>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
