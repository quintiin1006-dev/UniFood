import type {
  ClientDailyMenu,
  DailyMenuSelection,
  DailyMenuSingle,
} from "./types";
import { SKIP } from "./types";
import type { MenuCategoryId } from "../client/types";

/** Whether the card opens unfolded on Inicio. One line to change the default. */
export const DEFAULT_OPEN = false;

export const EMPTY_SELECTION: DailyMenuSelection = {
  choices: {},
  additionIds: [],
};

const singles = (menu: ClientDailyMenu) =>
  menu.categories.filter(
    (category): category is DailyMenuSingle => category.kind === "SINGLE",
  );

/** A choice counts only when it is still on today's menu (an option, or «Ninguna» if allowed). */
function isChosen(category: DailyMenuSingle, value: string | undefined) {
  if (value === undefined) return false;
  if (value === SKIP) return category.canSkip;
  return category.options.some(({ id }) => id === value);
}

/** Labels of the visible SINGLE categories still without a choice, in the card's order. */
export function missingChoices(
  menu: ClientDailyMenu,
  selection: DailyMenuSelection,
): string[] {
  return singles(menu)
    .filter((category) => !isChosen(category, selection.choices[category.id]))
    .map(({ label }) => label);
}

/** «2 de 4 elegidas»: only SINGLE categories count; additions are optional. */
export function selectionProgress(
  menu: ClientDailyMenu,
  selection: DailyMenuSelection,
) {
  const categories = singles(menu);
  return {
    done: categories.filter((category) =>
      isChosen(category, selection.choices[category.id]),
    ).length,
    total: categories.length,
  };
}

/** One choice per SINGLE category: a new one replaces the previous. */
export function choose(
  selection: DailyMenuSelection,
  categoryId: string,
  value: string,
): DailyMenuSelection {
  return {
    ...selection,
    choices: { ...selection.choices, [categoryId]: value },
  };
}

export function toggleAddition(
  selection: DailyMenuSelection,
  additionId: string,
): DailyMenuSelection {
  return {
    ...selection,
    additionIds: selection.additionIds.includes(additionId)
      ? selection.additionIds.filter((id) => id !== additionId)
      : [...selection.additionIds, additionId],
  };
}

/**
 * The catalogue slot the daily menu takes in Inicio: «Del día», the first category. While the
 * card is mounted, «Del día» products (if any) give way to it; «Corriente» and the others are
 * never touched. One place to change it.
 */
export const DAILY_MENU_SLOT: MenuCategoryId = "DEL_DIA";

/**
 * Inicio with or without the card. `replacing` is true while the card is mounted (loading or
 * shown): the slot category's products leave the sections, but its chip stays so the
 * filter can show the card. Without the card, Inicio is exactly as today.
 *
 * - `filterIds`: the category chips, in catalogue order (`order`).
 * - `active`: the chosen filter, or null («Todo») if it is not among the chips.
 * - `showCard`: with «Todo» or with the slot category's filter; hidden with the others.
 * - `sectionIds`: product sections to render.
 */
export function homeLayout({
  order,
  withProducts,
  replacing,
  filter,
}: {
  order: readonly MenuCategoryId[];
  withProducts: readonly MenuCategoryId[];
  replacing: boolean;
  filter: MenuCategoryId | null;
}) {
  const sectionIds = withProducts.filter(
    (id) => !replacing || id !== DAILY_MENU_SLOT,
  );
  const filterIds = order.filter(
    (id) => sectionIds.includes(id) || (replacing && id === DAILY_MENU_SLOT),
  );
  const active = filter && filterIds.includes(filter) ? filter : null;
  return {
    filterIds,
    active,
    showCard: replacing && (active === null || active === DAILY_MENU_SLOT),
    sectionIds: sectionIds.filter((id) => !active || id === active),
  };
}
