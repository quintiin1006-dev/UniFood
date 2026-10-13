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

export type CartLine = {
  id: string;
  mealId: string;
  quantity: number;
  notes: string;
};
export type ClientCart = { siteId: string | null; lines: CartLine[] };
