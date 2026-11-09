// Same order as the Java CatalogCategory enum, which the worker availability API follows.
// BEBIDA (019) goes last, as "Bebidas" does in the filters of docs/decisiones.md §6.
export const CATALOG_CATEGORIES = [
  "DEL_DIA",
  "CORRIENTE",
  "EJECUTIVO",
  "ESPECIAL",
  "DESAYUNO",
  "BEBIDA",
] as const;
export type CatalogCategory = (typeof CATALOG_CATEGORIES)[number];
export const CATEGORY_LABELS: Record<CatalogCategory, string> = {
  DEL_DIA: "Del día",
  CORRIENTE: "Corriente",
  EJECUTIVO: "Ejecutivo",
  ESPECIAL: "Especial",
  DESAYUNO: "Desayuno",
  BEBIDA: "Bebida",
};
export type AvailabilityItem = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  image: string | null;
  available: boolean;
};
export type TodayAvailability = {
  businessDate: string;
  cafeteria: { id: string; name: string; active: boolean; open: boolean };
  categories: { category: CatalogCategory; items: AvailabilityItem[] }[];
};
export type ItemAcknowledgement = {
  businessDate: string;
  itemId: string;
  available: boolean;
};
export type CafeteriaAcknowledgement = { businessDate: string; open: boolean };
