/**
 * Format a peso price, e.g. 7000 -> "₱70", 8050 -> "₱80.50".
 *
 * Whole-peso values render without decimals (byte-identical to before);
 * fractional values render with two decimals.
 */
export function formatPeso(price_cents: number): string {
  if (!Number.isInteger(price_cents) || price_cents % 100 !== 0) {
    return `₱${(price_cents / 100).toFixed(2)}`;
  }
  return `₱${price_cents / 100}`;
}
