// Catalog semantics already used by WORKER; daily availability is not part of this contract.
export {
  CATALOG_CATEGORIES,
  CATEGORY_LABELS,
} from "@/features/availability/types";
export type { CatalogCategory } from "@/features/availability/types";
import type { CatalogCategory } from "@/features/availability/types";

export type AdminProduct = {
  id: string;
  name: string;
  description: string | null;
  price: string;
  category: CatalogCategory;
  imageUrl: string | null;
  active: boolean;
  version: string;
};
export type CatalogForm = {
  name: string;
  description: string | null;
  price: string;
  category: CatalogCategory;
};
export type CatalogMutation =
  | { kind: "create"; form: CatalogForm }
  | { kind: "edit"; id: string; expectedVersion: string; form: CatalogForm }
  | { kind: "status"; id: string; expectedVersion: string; active: boolean };
export type AdminCatalogData = { products: AdminProduct[] };
export type CatalogFilters = {
  search: string;
  category: CatalogCategory | "";
  status: "all" | "active" | "inactive";
};
