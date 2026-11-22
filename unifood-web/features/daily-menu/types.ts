/**
 * GET /api/me/daily-menu?cafeteriaId= (docs/propuesta-menu-dinamico.md 3.2), as the BFF sends it
 * to the browser: only the published fields, prices as decimal strings ("9500.00").
 */
export type DailyMenuWire = {
  cafeteria: { id: string; name: string; open: boolean };
  businessDate: string;
  title: string;
  price: string;
  categories: DailyMenuWireCategory[];
};
export type DailyMenuWireCategory =
  | {
      id: string;
      label: string;
      kind: "SINGLE";
      canSkip: boolean;
      options: { id: string; label: string }[];
    }
  | {
      id: string;
      label: string;
      kind: "ADDITIONS";
      canSkip: boolean;
      additions: { id: string; name: string; extraPrice: string }[];
    };

export type DailyMenuOption = { id: string; label: string };
export type DailyMenuAddition = {
  id: string;
  name: string;
  /** For display only: the backend computes every price and total again. */
  extraPrice: number;
};
export type DailyMenuSingle = {
  id: string;
  label: string;
  kind: "SINGLE";
  canSkip: boolean;
  options: DailyMenuOption[];
};
export type DailyMenuAdditions = {
  id: string;
  label: string;
  kind: "ADDITIONS";
  additions: DailyMenuAddition[];
};
export type DailyMenuCategory = DailyMenuSingle | DailyMenuAdditions;

/** The card's menu: only categories the client can see today, in the template's order. */
export type ClientDailyMenu = {
  cafeteria: { id: string; name: string; open: boolean };
  businessDate: string;
  title: string;
  /** For display only. */
  price: number;
  categories: DailyMenuCategory[];
  /**
   * Skippable SINGLE categories with no options today: hidden on the card, but the backend
   * still expects «Ninguna» for each of them in the order (section 3.3).
   */
  hiddenSkips: string[];
};

/** «Ninguna» in a skippable SINGLE category. */
export const SKIP = "__skip__";

/** Local choice of the card: one value per SINGLE category (option id or SKIP), additions. */
export type DailyMenuSelection = {
  choices: Record<string, string>;
  additionIds: string[];
};

/**
 * GET /api/worker/daily-menu/today (section 3.2, worker side) as the BFF sends it: only the
 * published fields. Prices are decimal strings; `price` is null without a plate price.
 * `skippedCategories` only comes back from «Copiar el de ayer».
 */
export type WorkerDailyMenu = {
  businessDate: string;
  version: number;
  published: boolean;
  complete: boolean;
  missingCategories: string[];
  priceSet: boolean;
  title: string | null;
  price: string | null;
  categories: WorkerDailyMenuCategory[];
  additions: WorkerDailyMenuAddition[];
  skippedCategories?: string[];
};
export type WorkerDailyMenuCategory = {
  id: string;
  label: string;
  kind: "SINGLE";
  canSkip: boolean;
  options: DailyMenuOption[];
  textUsed: number;
};
export type WorkerDailyMenuAddition = {
  id: string;
  name: string;
  extraPrice: string | null;
  available: boolean;
};
