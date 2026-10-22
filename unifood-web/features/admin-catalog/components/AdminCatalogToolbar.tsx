"use client";
import { Search } from "lucide-react";
import {
  CATALOG_CATEGORIES,
  CATEGORY_LABELS,
  type CatalogFilters,
} from "../types";
import styles from "./AdminCatalog.module.css";

export function AdminCatalogToolbar({
  filters,
  onChange,
}: {
  filters: CatalogFilters;
  onChange: (filters: CatalogFilters) => void;
}) {
  return (
    <div
      className={styles.toolbar}
      role="search"
      aria-label="Buscar y filtrar catálogo"
    >
      <label className={styles.search}>
        <span>Buscar productos</span>
        <span className={styles.searchInput}>
          <Search size={18} aria-hidden="true" />
          <input
            type="search"
            placeholder="Buscar productos..."
            value={filters.search}
            onChange={(e) => onChange({ ...filters, search: e.target.value })}
          />
        </span>
      </label>
      <label>
        <span>Categoría</span>
        <select
          value={filters.category}
          onChange={(e) =>
            onChange({
              ...filters,
              category: e.target.value as CatalogFilters["category"],
            })
          }
        >
          <option value="">Todas</option>
          {CATALOG_CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {CATEGORY_LABELS[category]}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Estado</span>
        <select
          value={filters.status}
          onChange={(e) =>
            onChange({
              ...filters,
              status: e.target.value as CatalogFilters["status"],
            })
          }
        >
          <option value="all">Todos</option>
          <option value="active">Activos</option>
          <option value="inactive">Inactivos</option>
        </select>
      </label>
    </div>
  );
}
