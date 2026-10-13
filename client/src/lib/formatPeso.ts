/**
 * Format a whole-peso price for the showcase.
 *
 * All seed prices are whole pesos (multiples of 100), so this helper
 * renders whole pesos only, e.g. 7000 -> "₱70".
 */
export function formatPeso(price_cents: number): string {
  return `₱${price_cents / 100}`;
}
