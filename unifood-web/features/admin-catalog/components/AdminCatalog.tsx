"use client";
import { useState } from "react";
import { PackageSearch, CircleAlert } from "lucide-react";
import { useAdminCatalog } from "../useAdminCatalog";
import { filterCatalog } from "../presentation";
import type { CatalogFilters } from "../types";
import { AdminCatalogToolbar } from "./AdminCatalogToolbar";
import { AdminProductCard } from "./AdminProductCard";
import shell from "@/features/admin/components/Admin.module.css";
import styles from "./AdminCatalog.module.css";

export function AdminCatalog() {
  const { data, loading, error, retry } = useAdminCatalog();
  const [filters, setFilters] = useState<CatalogFilters>({
    search: "",
    category: "",
    status: "all",
  });
  const products = data ? filterCatalog(data.products, filters) : [];
  return (
    <section className={shell.section} aria-labelledby="admin-catalog-title">
      <p className={shell.eyebrow}>TU CAFETERÍA</p>
      <h1 id="admin-catalog-title">Catálogo</h1>
      <p className={shell.intro}>
        Administra los productos que ofrece tu cafetería.
      </p>
      {loading && (
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
          <AdminCatalogToolbar filters={filters} onChange={setFilters} />
          {products.length ? (
            <div className={styles.grid} aria-label="Productos del catálogo">
              {products.map((product) => (
                <AdminProductCard key={product.id} product={product} />
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
            Solo lectura · El estado del catálogo es independiente de la
            disponibilidad diaria.
          </p>
        </>
      )}
    </section>
  );
}
