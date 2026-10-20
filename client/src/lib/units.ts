/**
 * Standard units shared by the Guide ingredient rows and the Inventory
 * add/edit dialogs. Values are the short stored form; labels spell the
 * unit out for the pickers. Legacy spellings ("Pack", "btl", "grams", …)
 * normalize to these values so every picker offers one consistent list.
 */

export interface UnitOption {
  value: string;
  label: string;
}

export const UNIT_OPTIONS: readonly UnitOption[] = [
  { value: "g", label: "g (grams)" },
  { value: "kg", label: "kg (kilograms)" },
  { value: "ml", label: "ml (milliliters)" },
  { value: "L", label: "L (liters)" },
  { value: "pack", label: "pack" },
  { value: "bottle", label: "bottle" },
  { value: "can", label: "can" },
  { value: "scoop", label: "scoop" },
  { value: "pc", label: "pc (pieces)" },
  { value: "tbsp", label: "tbsp (tablespoons)" },
  { value: "tsp", label: "tsp (teaspoons)" },
] as const;

/** Lowercased alias → standard value. "btl" and "Pack" are live legacy data. */
const UNIT_ALIASES: Record<string, string> = {
  g: "g",
  gram: "g",
  grams: "g",
  gr: "g",
  kg: "kg",
  kgs: "kg",
  kilogram: "kg",
  kilograms: "kg",
  ml: "ml",
  mls: "ml",
  milliliter: "ml",
  milliliters: "ml",
  millilitre: "ml",
  millilitres: "ml",
  l: "L",
  liter: "L",
  liters: "L",
  litre: "L",
  litres: "L",
  ltr: "L",
  ltrs: "L",
  pack: "pack",
  packs: "pack",
  bottle: "bottle",
  bottles: "bottle",
  btl: "bottle",
  can: "can",
  cans: "can",
  scoop: "scoop",
  scoops: "scoop",
  pc: "pc",
  pcs: "pc",
  piece: "pc",
  pieces: "pc",
  tbsp: "tbsp",
  tbsps: "tbsp",
  tablespoon: "tbsp",
  tablespoons: "tbsp",
  tsp: "tsp",
  tsps: "tsp",
  teaspoon: "tsp",
  teaspoons: "tsp",
};

/**
 * Normalize a stored unit to its standard short form. Unknown values are
 * kept as typed (trimmed) so existing rows are never silently rewritten;
 * null/blank means "no unit".
 */
export function canonicalUnit(raw: string | null | undefined): string {
  const trimmed = (raw ?? "").trim();
  if (trimmed === "") return "";
  return UNIT_ALIASES[trimmed.toLowerCase()] ?? trimmed;
}

/**
 * Select values for a unit picker: the standard list plus, when the
 * stored unit is not standard (legacy rows), that value as an extra
 * option so editing an item never drops it.
 */
export function unitOptions(current?: string | null): string[] {
  const values = UNIT_OPTIONS.map((option) => option.value);
  const trimmed = (current ?? "").trim();
  if (trimmed === "" || values.includes(trimmed)) {
    return values;
  }
  return [...values, trimmed];
}

/** Option label for a unit value; non-standard values label as themselves. */
export function unitLabel(value: string): string {
  const option = UNIT_OPTIONS.find((candidate) => candidate.value === value);
  return option ? option.label : value;
}
