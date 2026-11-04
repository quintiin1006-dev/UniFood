export type ClientDetails = {
  document: string | null;
  phone: string | null;
  institution: string | null;
  unavailable: boolean;
};

export type MealKind = "breakfast" | "lunch";
export type CatalogMeal = {
  id: string;
  kind: MealKind;
  category: string;
  name: string;
  description: string;
  price: number;
  image: string;
  stock: number;
  availableDays: number[];
};

export type ClientSite = {
  id: string;
  name: string;
  city: string;
  image: string;
  cafeteria: string;
  meals: CatalogMeal[];
};

/** Menu served by the backend for the signed-in client's institution. */
export type ClientMenu = { sites: ClientSite[]; unavailable: boolean };

export type CartLine = {
  id: string;
  mealId: string;
  quantity: number;
  notes: string;
};
export type ClientCart = { siteId: string | null; lines: CartLine[] };
