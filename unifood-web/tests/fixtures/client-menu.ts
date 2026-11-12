// Test fixtures only: the app reads context and menu from the backend (B13, B14). These
// payloads follow the Spring contract, so they stay as plain data with erasable types:
// unit tests load this file through load-ts.mjs and the e2e provider imports it with Node.
import type { MenuCategoryId } from "../../features/client/types";

const id = (suffix: string) =>
  `00000000-0000-4000-8000-${suffix.padStart(12, "0")}`;

export const SITE_PRINCIPAL = id("101");
export const SITE_AGUAS_CLARAS = id("102");
export const SITE_NORTE = id("103");
/** Open, with every category: the default cafeteria for e2e. */
export const CAFETERIA_CENTRAL = id("201");
/** Closed today: products are visible but available: false. */
export const CAFETERIA_BLOQUE_B = id("202");
/** Open, without active products. */
export const CAFETERIA_AGUAS_CLARAS = id("203");
/** Its menu answers 503 with a private message that must never reach the screen. */
export const CAFETERIA_FAILING = id("204");

export const PRODUCT = {
  daily: id("301"),
  pericos: id("302"),
  broth: id("303"),
  chicken: id("304"),
  fish: id("305"),
  executive: id("306"),
  special: id("307"),
  juice: id("308"),
  lemonade: id("309"),
  closedChicken: id("310"),
  closedCoffee: id("311"),
};

type FixtureProduct = {
  id: string;
  name: string;
  description: string | null;
  price: string;
  imageUrl: null;
  available: boolean;
};
const product = (
  productId: string,
  name: string,
  price: string,
  available = true,
  description: string | null = null,
): FixtureProduct => ({
  id: productId,
  name,
  description,
  price,
  imageUrl: null,
  available,
});

const centralCategories: { id: MenuCategoryId; products: FixtureProduct[] }[] =
  [
    {
      id: "DEL_DIA",
      products: [
        product(
          PRODUCT.daily,
          "Bandeja del día",
          "16000.00",
          true,
          "Sopa, seco y jugo del día.",
        ),
      ],
    },
    {
      id: "DESAYUNO",
      products: [
        product(PRODUCT.pericos, "Huevos pericos con arepa", "8500.00"),
        product(PRODUCT.broth, "Caldo con arepa", "11000.00"),
      ],
    },
    {
      id: "CORRIENTE",
      products: [
        product(
          PRODUCT.chicken,
          "Pechuga a la plancha",
          "15000.00",
          true,
          "Con arroz y ensalada.",
        ),
        product(PRODUCT.fish, "Filete de pescado", "15000.00", false),
      ],
    },
    {
      id: "EJECUTIVO",
      products: [product(PRODUCT.executive, "Parrilla ejecutiva", "19000.00")],
    },
    {
      id: "ESPECIAL",
      products: [
        product(PRODUCT.special, "Especial de pescado", "22000.00", false),
      ],
    },
    {
      id: "BEBIDA",
      products: [
        product(PRODUCT.juice, "Jugo natural", "4500.00"),
        product(PRODUCT.lemonade, "Limonada de coco", "6000.00"),
      ],
    },
  ];

const BUSINESS_DATE = "2026-11-20";

export const clientMenus: Record<string, unknown> = {
  [CAFETERIA_CENTRAL]: {
    cafeteria: { id: CAFETERIA_CENTRAL, name: "Cafetería Central", open: true },
    businessDate: BUSINESS_DATE,
    categories: centralCategories,
  },
  [CAFETERIA_BLOQUE_B]: {
    cafeteria: {
      id: CAFETERIA_BLOQUE_B,
      name: "Cafetería Bloque B",
      open: false,
    },
    businessDate: BUSINESS_DATE,
    categories: [
      {
        id: "CORRIENTE",
        products: [
          product(
            PRODUCT.closedChicken,
            "Pechuga a la plancha",
            "15000.00",
            false,
          ),
        ],
      },
      {
        id: "BEBIDA",
        products: [product(PRODUCT.closedCoffee, "Tinto", "2000.00", false)],
      },
    ],
  },
  [CAFETERIA_AGUAS_CLARAS]: {
    cafeteria: {
      id: CAFETERIA_AGUAS_CLARAS,
      name: "Cafetería Aguas Claras",
      open: true,
    },
    businessDate: BUSINESS_DATE,
    categories: [],
  },
};

const cafeteria = (cafeteriaId: string, name: string, open: boolean) => ({
  id: cafeteriaId,
  name,
  open,
});

/** Several sites and cafeterias: selection, closed, empty, failing and an empty site. */
export const clientContext = {
  fullName: "Usuario de prueba",
  institution: { id: id("1"), name: "Universidad de prueba" },
  clientType: "STUDENT",
  sites: [
    {
      id: SITE_PRINCIPAL,
      name: "Sede Principal",
      cafeterias: [
        cafeteria(CAFETERIA_CENTRAL, "Cafetería Central", true),
        cafeteria(CAFETERIA_BLOQUE_B, "Cafetería Bloque B", false),
      ],
    },
    {
      id: SITE_AGUAS_CLARAS,
      name: "Sede Aguas Claras",
      cafeterias: [
        cafeteria(CAFETERIA_AGUAS_CLARAS, "Cafetería Aguas Claras", true),
        cafeteria(CAFETERIA_FAILING, "Cafetería Sin Servicio", true),
      ],
    },
    { id: SITE_NORTE, name: "Sede Norte", cafeterias: [] },
  ],
  activeOrder: null,
};

/** One site with one cafeteria: Inicio skips the selection (§4). */
export const singleCafeteriaContext = {
  ...clientContext,
  sites: [
    {
      id: SITE_PRINCIPAL,
      name: "Sede Principal",
      cafeterias: [cafeteria(CAFETERIA_CENTRAL, "Cafetería Central", true)],
    },
  ],
};

/** What Spring answers for GET /api/me/menu?cafeteriaId= in these fixtures. */
export function clientMenuResponse(cafeteriaId: string | null): {
  status: number;
  body: unknown;
} {
  if (cafeteriaId === CAFETERIA_FAILING)
    return {
      status: 503,
      body: {
        code: "MENU_TEMPORARILY_UNAVAILABLE",
        message: "PRIVATE_SPRING_MENU_DETAIL",
      },
    };
  const menu = cafeteriaId ? clientMenus[cafeteriaId] : undefined;
  return menu
    ? { status: 200, body: menu }
    : {
        status: 404,
        body: {
          code: "CAFETERIA_NOT_FOUND",
          message: "PRIVATE_SPRING_NOT_FOUND",
        },
      };
}
