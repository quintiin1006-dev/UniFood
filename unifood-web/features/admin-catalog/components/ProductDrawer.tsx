"use client";
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import {
  CATALOG_CATEGORIES,
  CATEGORY_LABELS,
  type AdminProduct,
  type CatalogForm,
  type CatalogMutation,
} from "../types";
import { validateCatalogForm, type FieldErrors } from "../commands";
import { AdminCatalogError } from "../errors";
import styles from "./AdminCatalog.module.css";

export type CatalogEditor =
  { kind: "create" } | { kind: "edit" | "status"; product: AdminProduct };
export function ProductDrawer({
  editor,
  allowed,
  save,
  refresh,
  close,
}: {
  editor: CatalogEditor;
  allowed: boolean;
  save: (command: CatalogMutation) => Promise<void>;
  refresh: () => Promise<void>;
  close: () => void;
}) {
  const product = editor.kind === "create" ? null : editor.product;
  const initial: CatalogForm = {
    name: product?.name ?? "",
    description: product?.description ?? null,
    price: product?.price ?? "",
    category: product?.category ?? "CORRIENTE",
  };
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const lock = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  useEffect(() => {
    returnTo.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const node = dialog.current;
    node?.showModal();
    return () => {
      node?.close();
      const previous = returnTo.current;
      if (previous?.isConnected && !previous.matches(":disabled"))
        previous.focus();
      else document.getElementById("admin-catalog-title")?.focus();
    };
  }, []);
  const requestClose = () => {
    if (lock.current) return;
    if (dirty || blocked) setDiscard(true);
    else close();
  };
  const submit = async () => {
    if (lock.current || !allowed || blocked) return;
    if (editor.kind !== "status") {
      const validation = validateCatalogForm(form);
      setErrors(validation);
      if (Object.keys(validation).length) {
        requestAnimationFrame(() =>
          dialog.current
            ?.querySelector<HTMLElement>('[aria-invalid="true"]')
            ?.focus(),
        );
        return;
      }
    }
    lock.current = true;
    setPending(true);
    setMessage("");
    try {
      const command: CatalogMutation =
        editor.kind === "create"
          ? { kind: "create", form }
          : editor.kind === "edit"
            ? {
                kind: "edit",
                form,
                id: editor.product.id,
                expectedVersion: editor.product.version,
              }
            : {
                kind: "status",
                id: editor.product.id,
                expectedVersion: editor.product.version,
                active: !editor.product.active,
              };
      await save(command);
      close();
    } catch (cause) {
      const error =
        cause instanceof AdminCatalogError ? cause : new AdminCatalogError(503);
      if (error.code === "ADMIN_CATALOG_DUPLICATE_NAME")
        setErrors({ name: error.message });
      const uncertain = error.status >= 500;
      const stale =
        error.code === "ADMIN_CATALOG_STALE_VERSION" || error.status === 404;
      setBlocked(uncertain || stale);
      setMessage(
        uncertain
          ? "No pudimos confirmar el resultado. Conservamos tu borrador. Revisa el catálogo antes de iniciar otra operación; no se reenviará automáticamente."
          : error.message,
      );
    } finally {
      lock.current = false;
      setPending(false);
    }
  };
  return (
    <dialog
      ref={dialog}
      className={styles.drawer}
      aria-labelledby="catalog-editor-title"
      onCancel={(e) => {
        e.preventDefault();
        requestClose();
      }}
      onKeyDown={(e) => {
        if (e.key !== "Tab") return;
        const controls = e.currentTarget.querySelectorAll<HTMLElement>(
          "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]",
        );
        const first = controls[0],
          last = controls[controls.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }}
    >
      <div className={styles.drawerHeading}>
        <div>
          <p className={styles.category}>CATÁLOGO DE TU CAFETERÍA</p>
          <h2 id="catalog-editor-title">
            {editor.kind === "create"
              ? "Nuevo producto"
              : editor.kind === "edit"
                ? "Editar producto"
                : product?.active
                  ? "Desactivar producto"
                  : "Activar producto"}
          </h2>
        </div>
        <button
          type="button"
          onClick={requestClose}
          disabled={pending}
          aria-label="Cerrar editor"
        >
          <X size={22} aria-hidden="true" />
        </button>
      </div>
      {discard ? (
        <div className={styles.discard} role="alert">
          <h3>¿Cerrar el editor?</h3>
          <p>
            Se descartará el borrador. Una operación cuyo resultado no pudo
            confirmarse podría haberse guardado; revisa el catálogo antes de
            volver a crearla.
          </p>
          <button type="button" onClick={() => setDiscard(false)}>
            Seguir revisando
          </button>
          <button type="button" onClick={close}>
            Descartar borrador y cerrar
          </button>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          noValidate
        >
          {!allowed && (
            <p role="status" className={styles.notice}>
              Los cambios están deshabilitados mientras se verifica tu acceso o
              la cafetería está inactiva.
            </p>
          )}
          {editor.kind === "status" ? (
            <p className={styles.statusCopy}>
              {product?.active
                ? "¿Desactivar “" +
                  product.name +
                  "”? Dejará de aparecer en Disponibilidad. Los pedidos existentes se conservan."
                : "Al activar “" +
                  product?.name +
                  "”, WORKER deberá habilitarlo para el día actual antes de ofrecerlo."}
            </p>
          ) : (
            <fieldset
              disabled={!allowed || pending || blocked}
              className={styles.fields}
            >
              <label htmlFor="catalog-name">Nombre</label>
              <input
                id="catalog-name"
                value={form.name}
                autoComplete="off"
                aria-required="true"
                aria-invalid={!!errors.name}
                aria-describedby={
                  errors.name ? "catalog-name-error" : undefined
                }
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
              {errors.name && (
                <p id="catalog-name-error" className={styles.fieldError}>
                  {errors.name}
                </p>
              )}
              <label htmlFor="catalog-description">
                Descripción (opcional)
              </label>
              <textarea
                id="catalog-description"
                rows={5}
                value={form.description ?? ""}
                aria-invalid={!!errors.description}
                aria-describedby={
                  errors.description ? "catalog-description-error" : undefined
                }
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value || null })
                }
              />
              {errors.description && (
                <p id="catalog-description-error" className={styles.fieldError}>
                  {errors.description}
                </p>
              )}
              <label htmlFor="catalog-price">Precio (COP)</label>
              <input
                id="catalog-price"
                inputMode="decimal"
                value={form.price}
                aria-required="true"
                aria-invalid={!!errors.price}
                aria-describedby={
                  errors.price ? "catalog-price-error" : undefined
                }
                onChange={(e) => setForm({ ...form, price: e.target.value })}
              />
              {errors.price && (
                <p id="catalog-price-error" className={styles.fieldError}>
                  {errors.price}
                </p>
              )}
              <label htmlFor="catalog-category">Categoría del producto</label>
              <select
                id="catalog-category"
                value={form.category}
                onChange={(e) =>
                  setForm({
                    ...form,
                    category: e.target.value as CatalogForm["category"],
                  })
                }
              >
                {CATALOG_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
              {errors.category && (
                <p className={styles.fieldError}>{errors.category}</p>
              )}
            </fieldset>
          )}
          {message && (
            <div role="alert" className={styles.notice}>
              <p>{message}</p>
              {blocked && (
                <>
                  <button
                    type="button"
                    disabled={reconciling}
                    onClick={async () => {
                      setReconciling(true);
                      try {
                        await refresh();
                      } finally {
                        setReconciling(false);
                      }
                    }}
                  >
                    {reconciling ? "Actualizando…" : "Revisar catálogo"}
                  </button>
                  <p>
                    El borrador permanece aquí. Cierra y vuelve a abrir el
                    producto para trabajar con su versión actual.
                  </p>
                </>
              )}
            </div>
          )}
          <div className={styles.drawerFooter}>
            <button type="button" disabled={pending} onClick={requestClose}>
              Cancelar
            </button>
            <button
              type="submit"
              className={styles.primary}
              disabled={!allowed || pending || blocked}
            >
              {pending
                ? "Guardando…"
                : editor.kind === "status"
                  ? product?.active
                    ? "Confirmar desactivación"
                    : "Confirmar activación"
                  : "Guardar producto"}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
