"use client";
import { useRef, useState } from "react";
import { PackageSearch, CircleAlert } from "lucide-react";
import { useAdminCatalog } from "../useAdminCatalog";
import { filterCatalog } from "../presentation";
import type { CatalogFilters, CatalogMutation } from "../types";
import { catalogImageRequest, type ImageAttempt } from "../image-api";
import { useAdminProfile } from "@/features/admin-profile/context";
import { adminCatalogApi } from "../api";
import { AdminCatalogError } from "../errors";
import { ProductDrawer, type CatalogEditor } from "./ProductDrawer";
import { AdminCatalogToolbar } from "./AdminCatalogToolbar";
import { AdminProductCard } from "./AdminProductCard";
import shell from "@/features/admin/components/Admin.module.css";
import styles from "./AdminCatalog.module.css";

export function AdminCatalog() {
  const {
    data,
    loading,
    error,
    retry,
    applyConfirmed,
    invalidateReads,
    denyAccess,
  } = useAdminCatalog();
  const profile = useAdminProfile();
  const [editor, setEditor] = useState<CatalogEditor | null>(null);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState("");
  const writeLock = useRef(false);
  const [deniedContext, setDeniedContext] = useState<typeof profile.data>(null);
  const allowed =
    !!profile.data?.cafeteria.active &&
    profile.data !== deniedContext &&
    !profile.loading &&
    !profile.error &&
    !saving &&
    !loading &&
    !error;
  const save = async (command: CatalogMutation) => {
    if (!allowed || writeLock.current) throw new AdminCatalogError(403);
    writeLock.current = true;
    setSaving(true);
    setSuccess("");
    const authorizationRevision = invalidateReads();
    try {
      const confirmed = await adminCatalogApi.mutate(command);
      applyConfirmed(confirmed, authorizationRevision);
      setSuccess(
        command.kind === "create"
          ? "Producto creado."
          : "Producto actualizado.",
      );
      void retry();
      return confirmed;
    } catch (cause) {
      if (
        cause instanceof AdminCatalogError &&
        [401, 403].includes(cause.status)
      ) {
        setDeniedContext(profile.data);
        if (cause.code !== "ADMIN_CATALOG_CAFETERIA_INACTIVE")
          denyAccess(cause.status);
        void profile.retry();
      }
      throw cause;
    } finally {
      writeLock.current = false;
      setSaving(false);
    }
  };
  const image = async (attempt: ImageAttempt, reconcile = false) => {
    if (
      !profile.data ||
      profile.data === deniedContext ||
      writeLock.current ||
      (!reconcile && !profile.data.cafeteria.active)
    )
      throw new AdminCatalogError(403);
    writeLock.current = true;
    setSaving(true);
    setSuccess("");
    const revision = invalidateReads();
    try {
      const result = await catalogImageRequest(attempt, reconcile);
      if (result.state === "APPLIED") {
        applyConfirmed(result.product, revision);
        setSuccess("Producto e imagen guardados.");
        void retry();
      }
      return result;
    } catch (cause) {
      if (
        cause instanceof AdminCatalogError &&
        [401, 403].includes(cause.status)
      ) {
        setDeniedContext(profile.data);
        if (cause.code !== "ADMIN_CATALOG_CAFETERIA_INACTIVE")
          denyAccess(cause.status);
        void profile.retry();
      }
      throw cause;
    } finally {
      writeLock.current = false;
      setSaving(false);
    }
  };
  const [filters, setFilters] = useState<CatalogFilters>({
    search: "",
    category: "",
    status: "all",
  });
  const products = data ? filterCatalog(data.products, filters) : [];
  return (
    <section className={shell.section} aria-labelledby="admin-catalog-title">
      <p className={shell.eyebrow}>TU CAFETERÍA</p>
      <h1 id="admin-catalog-title" tabIndex={-1}>
        Catálogo
      </h1>
      <p className={shell.intro}>
        Administra los productos que ofrece tu cafetería.
      </p>
      {success && (
        <p role="status" className={styles.success}>
          {success}
        </p>
      )}
      {loading && !data && (
        <div className={styles.feedback} role="status">
          Cargando el catálogo…
        </div>
      )}
      {error && (
        <div className={styles.feedback} role="alert">
          <CircleAlert size={24} aria-hidden="true" />
          <p>{error.message}</p>
          {error.status === 401 ? (
            <a href="/panel/login">Iniciar sesión</a>
          ) : (
            error.status !== 403 && (
              <button type="button" onClick={() => void retry()}>
                Reintentar
              </button>
            )
          )}
        </div>
      )}
      {data && (
        <>
          <div className={styles.catalogActions}>
            <button
              type="button"
              className={styles.primary}
              disabled={!allowed}
              onClick={() => {
                setSuccess("");
                setEditor({ kind: "create" });
              }}
            >
              Nuevo producto
            </button>
          </div>
          <AdminCatalogToolbar filters={filters} onChange={setFilters} />
          {products.length ? (
            <div className={styles.grid} aria-label="Productos del catálogo">
              {products.map((product) => (
                <AdminProductCard
                  key={product.id}
                  product={product}
                  disabled={!allowed}
                  onEdit={() => {
                    setSuccess("");
                    setEditor({ kind: "edit", product });
                  }}
                  onStatus={() => {
                    setSuccess("");
                    setEditor({ kind: "status", product });
                  }}
                />
              ))}
            </div>
          ) : (
            <div className={styles.empty} role="status">
              <PackageSearch size={36} strokeWidth={1.3} aria-hidden="true" />
              <p>
                {data.products.length === 0
                  ? "Aún no hay productos en el catálogo."
                  : filters.search.trim()
                    ? "No encontramos productos que coincidan con tu búsqueda."
                    : "No hay productos que coincidan con los filtros seleccionados."}
              </p>
            </div>
          )}
          <p className={styles.readOnly}>
            El estado del catálogo es independiente de la disponibilidad diaria.
          </p>
        </>
      )}
      {data && editor && error?.status !== 401 && error?.status !== 403 && (
        <ProductDrawer
          editor={editor}
          allowed={allowed || saving}
          save={save}
          image={image}
          refresh={retry}
          close={() => setEditor(null)}
        />
      )}
    </section>
  );
}
