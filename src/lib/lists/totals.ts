/**
 * What a list line costs at the till.
 *
 * `priceCentsSnapshot` is the price of ONE unit bought on its own — the shelf
 * price, or the per-unit campaign price where one applies to a single unit.
 * A multi-buy ("2 kpl 4,50 €") is carried separately in `offerAmount` and
 * `offerBundleCents`, because it only applies to complete bundles: buying one
 * of a "2 for 4,50" costs the shelf price 2,39, not half the bundle.
 *
 * This mirrors `lineTotal()` in the K-Ruoka normalizer, working from the
 * snapshot fields so totals stay right with no connection.
 */
export interface PricedLine {
  priceCentsSnapshot: number | null;
  offerAmount: number | null;
  offerBundleCents: number | null;
  qty: number;
}

export function lineTotalCents(line: PricedLine): number | null {
  const unit = line.priceCentsSnapshot;
  if (unit === null || line.qty <= 0) return null;

  const amount = line.offerAmount ?? 1;
  if (amount <= 1 || line.offerBundleCents === null) return Math.round(unit * line.qty);

  const bundles = Math.floor(line.qty / amount);
  const remainder = line.qty - bundles * amount;
  return Math.round(bundles * line.offerBundleCents + remainder * unit);
}

export function sumCents(lines: PricedLine[]): number {
  return lines.reduce((acc, line) => acc + (lineTotalCents(line) ?? 0), 0);
}
