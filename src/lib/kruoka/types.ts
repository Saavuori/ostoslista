/**
 * Domain types for product data.
 *
 * These are OURS, not K-Ruoka's. Everything from the upstream API passes through
 * `normalize.ts` before it reaches the rest of the app, so a change in their
 * undocumented payload shape breaks one file instead of the whole codebase.
 */

/** How the store charges for the item. Drives quantity entry in the UI. */
export type SoldBy = "piece" | "mass" | "approximatePiece";

/** The unit a quantity is counted in. */
export type QtyUnit = "kpl" | "kg" | "l";

export type OfferKind = "normal" | "discount" | "batch";

/**
 * A single price a customer could pay.
 *
 * The important subtlety: for `batch` offers upstream reports the price of the
 * whole bundle ("2 for 4,50"), not the per-unit price. `effectiveUnitPrice`
 * normalises that away so totals never have to care which kind they are holding.
 */
export interface PriceOffer {
  kind: OfferKind;
  /** What you pay at the till for `amount` units, in EUR. */
  price: number;
  /** Units you must buy to get this price. 1 for normal and plain discounts. */
  amount: number;
  /** price / amount — always the cost of one unit. */
  effectiveUnitPrice: number;
  /** Unit the price is expressed in: "kpl" for pieces, "kg" for loose goods. */
  unit: QtyUnit;
  /** Comparison price (per kg / per l), for shelf-label style display. */
  comparisonPrice: number | null;
  comparisonUnit: string | null;
  /** True when the price is an estimate because the item is weighed at the till. */
  isApproximate: boolean;
  discountPercent: number | null;
  /** e.g. "PLUSSA" — requires a loyalty card. */
  discountType: string | null;
  validUntil: string | null;
}

export interface ProductPricing {
  /** Shelf price with no card and no campaign. Always present. */
  normal: PriceOffer;
  /** Cheapest offer by `effectiveUnitPrice`. What list totals use. */
  best: PriceOffer;
  /** Every offer found, including `normal`. */
  offers: PriceOffer[];
}

export interface Product {
  /** Upstream id: EAN, or "EAN-STOREID" for store-local items. Unique per store. */
  id: string;
  ean: string;
  storeId: string;
  /** Store-specific item (fish counter, bakery) that has no national EAN. */
  isLocal: boolean;
  name: string;
  nameSv: string | null;
  nameEn: string | null;
  brand: string | null;
  /** Slug path, e.g. "kala-ja-merenelavat/tuorekala/lohi". */
  categoryPath: string | null;
  /** Human-readable leaf category, e.g. "Lohi". */
  categoryName: string | null;
  /**
   * Store department code (e.g. "1102"). This is the closest thing the data has
   * to a physical aisle, so it drives shopping-mode ordering.
   */
  section: string | null;
  /** Upstream category ordering — roughly the order you walk the store. */
  categoryOrder: number | null;
  imageUrl: string | null;
  originCountry: string | null;
  contentSize: number | null;
  contentUnit: string | null;
  soldBy: SoldBy;
  /** Present for approximate-piece goods (a whole fish ~1.5 kg). */
  averageWeight: number | null;
  isAvailable: boolean;
  /** Upstream popularity score; useful for ranking autocomplete. */
  popularity: number;
  pricing: ProductPricing;
}

export interface ProductSearchResult {
  products: Product[];
  storeId: string;
  query: string;
  /** True when upstream signalled more results beyond this page. */
  hasMore: boolean;
}
