export const HOME_GEAR_CATEGORY_EVENT = "dbc:home-gear-category-select";

export function selectHomeGearCategory(category: string) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(HOME_GEAR_CATEGORY_EVENT, { detail: { category } }));
  }
}
