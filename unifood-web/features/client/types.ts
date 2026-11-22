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
  /** dailyMenu.available: the flag is on and today's menu is published and complete. */
  dailyMenuAvailable: boolean;
};

/** A product line. Lines saved before the daily menu have no `kind` and are products too. */
export type ProductLine = {
  kind?: undefined;
  productId: string;
  quantity: number;
};
/** «NONE» is «Ninguna» in a skippable category. */
export const MENU_NONE = "NONE";
/**
 * The daily menu plate (docs/propuesta-menu-dinamico.md 4.6): ids only, never a price or a
 * label. At most one per cart; it counts as 1 unit of the 15.
 */
export type MenuLine = {
  kind: "menu";
  businessDate: string;
  /** categoryId → optionId, or MENU_NONE. */
  choices: Record<string, string>;
  additionIds: string[];
};
export type CartLine = ProductLine | MenuLine;
export type ClientCart = { cafeteriaId: string | null; lines: CartLine[] };
