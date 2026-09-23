/**
 * Finnish formatting.
 *
 * Centralised because a price rendered two different ways in one column looks
 * like a bug even when both are correct.
 */

const eurFormatter = new Intl.NumberFormat("fi-FI", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** 239 -> "2,39 €" */
export function formatCents(cents: number): string {
  return eurFormatter.format(cents / 100);
}

/**
 * Quantity with its unit: "2 kpl", "0,4 kg".
 *
 * Trailing zeros are dropped — "1 kpl" reads better than "1,000 kpl" — but
 * fractional weights keep the precision that was entered.
 */
export function formatQty(qty: number, unit: string): string {
  const formatted = new Intl.NumberFormat("fi-FI", {
    maximumFractionDigits: 3,
  }).format(qty);
  return `${formatted} ${unit}`;
}
