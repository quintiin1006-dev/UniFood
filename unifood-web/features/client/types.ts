export type ClientDetails = {
  document: string | null;
  phone: string | null;
  institution: string | null;
  unavailable: boolean;
};

/** catalog_category values, in the order of the §6 filters. */
export type MenuCategoryId =
  "DEL_DIA" | "DESAYUNO" | "CORRIENTE" | "EJECUTIVO" | "ESPECIAL" | "BEBIDA";

export type ContextCafeteria = { id: string; name: string; open: boolean };
export type ContextSite = {
  id: string;
  name: string;
  cafeterias: ContextCafeteria[];
};
/** GET /api/me/context (B13). Sites only list subscribed cafeterias. */
export type ClientContext = {
  fullName: string | null;
  institution: { id: string; name: string };
  sites: ContextSite[];
  activeOrderId: string | null;
};

export type MenuProduct = {
  id: string;
  name: string;
  description: string | null;
  /** For display only: the backend computes every price and total again. */
  price: number;
  available: boolean;
  category: MenuCategoryId;
};
export type MenuCategory = { id: MenuCategoryId; products: MenuProduct[] };
/** GET /api/me/menu?cafeteriaId= (B14). */
export type CafeteriaMenu = {
  cafeteria: ContextCafeteria;
  businessDate: string;
  categories: MenuCategory[];
};

export type CartLine = { productId: string; quantity: number };
export type ClientCart = { cafeteriaId: string | null; lines: CartLine[] };
