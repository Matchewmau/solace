/**
 * Client-side menu variant helpers. parseVariants mirrors the server
 * normalizeVariants rule: split commas, trim, drop empties, dedupe
 * case-insensitively keeping the first case, cap 8 options. Parens are
 * literal characters inside an option.
 */
export function parseVariants(input: string): string[] {
  const seen = new Set<string>();
  const variants: string[] = [];
  for (const part of input.split(",")) {
    const option = part.trim();
    if (option === "") continue;
    const key = option.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    variants.push(option);
    if (variants.length >= 8) break;
  }
  return variants;
}

/** Cart label: `Name` when no variant was chosen, else `Name (Choice)`. */
export function formatVariantLabel(name: string, variant: string | null): string {
  if (variant === null || variant.trim() === "") return name;
  return `${name} (${variant})`;
}
