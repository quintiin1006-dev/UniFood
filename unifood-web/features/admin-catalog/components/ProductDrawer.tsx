"use client";
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import Image from "next/image";
import {
  CATALOG_CATEGORIES,
  CATEGORY_LABELS,
  type AdminProduct,
  type CatalogForm,
  type CatalogMutation,
} from "../types";
import { validateCatalogForm, type FieldErrors } from "../commands";
import { AdminCatalogError, catalogErrorCode } from "../errors";
import { IMAGE_MAX_BYTES, managedCatalogImage } from "../images";
import type { ImageAttempt } from "../image-api";
import type { ImageOperation } from "../image-contracts";
import styles from "./AdminCatalog.module.css";

export type CatalogEditor =
  { kind: "create" } | { kind: "edit" | "status"; product: AdminProduct };
export function ProductDrawer({
  editor,
  allowed,
  save,
  image,
  refresh,
  close,
}: {
  editor: CatalogEditor;
  allowed: boolean;
  save: (command: CatalogMutation) => Promise<AdminProduct>;
  image: (
    attempt: ImageAttempt,
    reconcile?: boolean,
  ) => Promise<ImageOperation>;
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
  const [baseline, setBaseline] = useState(initial);
  const [confirmed, setConfirmed] = useState(product);
  const [file, setFile] = useState<File | null>(null);
  const [removeImage, setRemoveImage] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [attempt, setAttempt] = useState<ImageAttempt | null>(null);
  const [retryMissing, setRetryMissing] = useState(false);
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const lock = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const commercialDirty = JSON.stringify(form) !== JSON.stringify(baseline);
  const dirty = commercialDirty || !!file || removeImage;
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
    let imagePhase = false;
    let definitiveImageFailure = false;
    try {
      let current = confirmed;
      if (editor.kind === "status") {
        await save({
          kind: "status",
          id: editor.product.id,
          expectedVersion: editor.product.version,
          active: !editor.product.active,
        });
      } else {
        if (!current || commercialDirty || (!file && !removeImage)) {
          current = await save(
            current
              ? {
                  kind: "edit",
                  form,
                  id: current.id,
                  expectedVersion: current.version,
                }
              : { kind: "create", form },
          );
          setConfirmed(current);
          setBaseline({ ...form });
        }
        if ((file || removeImage) && current) {
          imagePhase = true;
          const next = {
            productId: current.id,
            expectedVersion: current.version,
            key: crypto.randomUUID(),
            file,
          };
          setAttempt(next);
          const result = await image(next);
          if (result.state !== "APPLIED") {
            if (result.state === "REJECTED") {
              definitiveImageFailure = true;
              setAttempt(null);
              throw new AdminCatalogError(
                result.failureStatus!,
                catalogErrorCode(result.failureStatus!, result.failureCode),
              );
            }
            setBlocked(true);
            setMessage(
              "El producto está guardado. La imagen sigue en proceso; comprueba el resultado antes de reintentar.",
            );
            return;
          }
          setConfirmed(result.product);
          setAttempt(null);
        }
      }
      close();
    } catch (cause) {
      const error =
        cause instanceof AdminCatalogError ? cause : new AdminCatalogError(503);
      if (error.code === "ADMIN_CATALOG_DUPLICATE_NAME")
        setErrors({ name: error.message });
      const uncertain = error.status >= 500;
      const stale =
        error.code === "ADMIN_CATALOG_STALE_VERSION" || error.status === 404;
      if (imagePhase && !uncertain) setAttempt(null);
      setBlocked(
        (uncertain && !definitiveImageFailure) || stale || error.status === 403,
      );
      setMessage(
        (imagePhase
          ? "El producto comercial está guardado. La imagen no está confirmada. "
          : "") +
          (uncertain
            ? "No pudimos confirmar el resultado. Conservamos tu borrador. Revisa el catálogo antes de iniciar otra operación; no se reenviará automáticamente."
            : error.message),
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
          {editor.kind !== "status" && (
            <fieldset
              className={styles.imageEditor}
              disabled={!allowed || pending || blocked}
            >
              <legend>Imagen del producto (opcional)</legend>
              <label htmlFor="catalog-image">
                {confirmed?.imageUrl
                  ? "Reemplazar imagen"
                  : "Seleccionar imagen"}
              </label>
              <input
                id="catalog-image"
                type="file"
                accept="image/jpeg,image/png"
                aria-describedby="catalog-image-help"
                onChange={(event) => {
                  const selected = event.target.files?.[0];
                  setMessage("");
                  if (!selected) return;
                  if (
                    selected.size > IMAGE_MAX_BYTES ||
                    !["image/jpeg", "image/png"].includes(selected.type)
                  ) {
                    setMessage(
                      "Selecciona JPEG o PNG estática de hasta 3 MiB.",
                    );
                    event.target.value = "";
                    return;
                  }
                  setFile(selected);
                  setPreview(URL.createObjectURL(selected));
                  setRemoveImage(false);
                  event.target.value = "";
                }}
              />
              <p id="catalog-image-help">
                JPEG o PNG estática, hasta 3 MiB. Lados de 256 a 4096 px y
                máximo 16 millones de píxeles.
              </p>
              {(preview || (!removeImage && confirmed?.imageUrl)) && (
                <div className={styles.imagePreview}>
                  <Image
                    src={preview ?? confirmed!.imageUrl!}
                    alt="Vista previa de la imagen del producto"
                    width={320}
                    height={220}
                    unoptimized={
                      !!preview ||
                      managedCatalogImage(confirmed?.imageUrl ?? null)
                    }
                  />
                </div>
              )}
              {(file || (!removeImage && confirmed?.imageUrl)) && (
                <button
                  type="button"
                  onClick={() => {
                    setFile(null);
                    setPreview(null);
                    setRemoveImage(!!confirmed?.imageUrl);
                  }}
                >
                  Quitar imagen
                </button>
              )}
              {removeImage && (
                <p role="status">
                  La imagen se quitará al guardar. Puedes cancelar para
                  conservarla.
                </p>
              )}
              {removeImage && (
                <button type="button" onClick={() => setRemoveImage(false)}>
                  Conservar imagen
                </button>
              )}
            </fieldset>
          )}
          {pending && (
            <p role="status" className={styles.notice}>
              Guardando y verificando el resultado…
            </p>
          )}
          {message && (
            <div role="alert" className={styles.notice}>
              <p>{message}</p>
              {attempt && (
                <>
                  <p>
                    El producto comercial puede estar guardado. No vuelvas a
                    crearlo: comprueba esta operación de imagen.
                  </p>
                  <button
                    type="button"
                    disabled={pending || reconciling}
                    onClick={async () => {
                      if (lock.current) return;
                      lock.current = true;
                      setReconciling(true);
                      try {
                        const result = await image(attempt, !retryMissing);
                        setRetryMissing(false);
                        if (result.state === "APPLIED") {
                          setConfirmed(result.product);
                          setAttempt(null);
                          close();
                        } else if (result.state === "REJECTED") {
                          setAttempt(null);
                          setBlocked(
                            [403, 404, 409].includes(result.failureStatus!),
                          );
                          setMessage(
                            "El producto permanece guardado. La imagen no se aplicó. " +
                              new AdminCatalogError(
                                result.failureStatus!,
                                catalogErrorCode(
                                  result.failureStatus!,
                                  result.failureCode,
                                ),
                              ).message,
                          );
                        } else
                          setMessage(
                            "La imagen sigue en proceso. Puedes volver a comprobar el resultado.",
                          );
                      } catch (cause) {
                        const error =
                          cause instanceof AdminCatalogError
                            ? cause
                            : new AdminCatalogError(503);
                        if (error.status === 404) {
                          setRetryMissing(true);
                          setMessage(
                            "No hay una operación confirmada. Puedes reenviar exactamente el mismo intento, sin volver a crear el producto.",
                          );
                        } else setMessage(error.message);
                      } finally {
                        lock.current = false;
                        setReconciling(false);
                      }
                    }}
                  >
                    {reconciling
                      ? "Comprobando…"
                      : retryMissing
                        ? "Reenviar mismo intento de imagen"
                        : "Comprobar resultado de imagen"}
                  </button>
                </>
              )}
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
