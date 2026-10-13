// Frontend fixtures only. Site names are confirmed; menus, prices and stock are provisional.
import type { CatalogMeal } from "../types";
export const demoSites = [
  {
    id: "principal",
    name: "Sede Principal",
    city: "Villavicencio",
    image: "/images/client/campus.png",
    cafeteria: "Cafetería Central",
  },
  {
    id: "aguas-claras",
    name: "Sede Aguas Claras",
    city: "Villavicencio",
    image: "/images/client/campus-modern.png",
    cafeteria: "Cafetería Aguas Claras",
  },
] as const;
export type DemoSite = (typeof demoSites)[number];
export const demoCategories = [
  {
    id: "desayunos",
    name: "Desayunos",
    description:
      "Empieza el día con algo rico. Combos completos, recién preparados.",
  },
  {
    id: "almuerzos",
    name: "Almuerzos",
    description: "Encuentra tu plato para la pausa del día.",
  },
  {
    id: "corriente",
    name: "Almuerzo corriente",
    description: "Platos completos para tu pausa del día.",
  },
  {
    id: "ejecutivos",
    name: "Ejecutivos",
    description: "Una pausa con un sabor diferente.",
  },
  {
    id: "especiales",
    name: "Especiales",
    description: "Algo especial para disfrutar con calma.",
  },
] as const;
export type DemoCategory = (typeof demoCategories)[number];
export const demoMeals = [
  {
    id: "breakfast-eggs",
    category: "desayunos",
    name: "Huevos con arepa y chocolate",
    description: "Huevos fritos, arepa asada y una taza de chocolate caliente.",
    price: 10000,
    image: "/images/client/breakfast-eggs.png",
  },
  {
    id: "breakfast-broth",
    category: "desayunos",
    name: "Caldo con arepa",
    description:
      "Caldo de costilla con papa y cilantro, acompañado de arepa asada.",
    price: 11000,
    image: "/images/client/breakfast-broth.png",
  },
  {
    id: "breakfast-pericos",
    category: "desayunos",
    name: "Huevos pericos con arepa",
    description:
      "Huevos revueltos con tomate y cebolla, acompañados de arepa asada.",
    price: 8500,
    image: "/images/client/breakfast-pericos.png",
  },
  {
    id: "breakfast-chocolate",
    category: "desayunos",
    name: "Chocolate con arepa y queso",
    description:
      "Chocolate caliente, arepa asada y una porción de queso fresco.",
    price: 7500,
    image: "/images/client/breakfast-chocolate.png",
  },
  {
    id: "breakfast-complete",
    category: "desayunos",
    name: "Desayuno completo",
    description: "Huevos revueltos, caldo, arepa asada y chocolate caliente.",
    price: 16000,
    image: "/images/client/breakfast-complete.png",
  },
  {
    id: "chicken",
    category: "corriente",
    name: "Pechuga a la plancha",
    description: "Con arroz, ensalada y bebida del día.",
    price: 15000,
    image: "/images/client/chicken.png",
  },
  {
    id: "beef",
    category: "corriente",
    name: "Carne a la parrilla",
    description: "Con arroz, ensalada y bebida del día.",
    price: 15000,
    image: "/images/client/beef.png",
  },
  {
    id: "fish",
    category: "corriente",
    name: "Filete de pescado",
    description: "Con arroz, ensalada y bebida del día.",
    price: 15000,
    image: "/images/client/fish.png",
  },
  {
    id: "executive-beef",
    category: "ejecutivos",
    name: "Parrilla ejecutiva",
    description: "Carne a la parrilla, arroz, aguacate y ensalada.",
    price: 19000,
    image: "/images/client/beef.png",
  },
  {
    id: "executive-chicken",
    category: "ejecutivos",
    name: "Pollo ejecutivo",
    description: "Pechuga a la plancha con acompañamientos del día.",
    price: 18000,
    image: "/images/client/chicken.png",
  },
  {
    id: "special-fish",
    category: "especiales",
    name: "Especial de pescado",
    description: "Pescado a la plancha, ensalada fresca y arroz.",
    price: 22000,
    image: "/images/client/fish.png",
  },
] as const;
export function findDemoSite(value: string | string[] | undefined) {
  return demoSites.find((site) => site.id === value);
}
export function findDemoCategory(value: string | string[] | undefined) {
  return demoCategories.find((category) => category.id === value);
}
export function demoMenuHref(site: DemoSite, category: DemoCategory) {
  return `/cuenta/menu?sede=${site.id}&categoria=${category.id}`;
}

export function getSiteMeals(site: DemoSite): CatalogMeal[] {
  return demoMeals
    .filter((meal) => site.id === "principal" || meal.category !== "desayunos")
    .map((meal) => ({
      ...meal,
      kind: meal.category === "desayunos" ? "breakfast" : "lunch",
      price: meal.price + (site.id === "aguas-claras" ? 1000 : 0),
      stock:
        meal.id === "special-fish"
          ? 0
          : meal.id === "breakfast-complete"
            ? 2
            : site.id === "principal"
              ? 12
              : 8,
      availableDays:
        meal.id === "executive-beef" ? [1, 2, 3, 4, 5] : [0, 1, 2, 3, 4, 5, 6],
    }));
}

export function mealHref(siteId: string, mealId: string) {
  return `/cuenta/producto/${mealId}?sede=${siteId}`;
}
