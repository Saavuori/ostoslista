import { aisleOrderForSlug, departmentNameForSlug } from "./aisles";
import type { OfferKind, PriceOffer, Product, ProductPricing, QtyUnit, SoldBy } from "./types";

/**
 * Maps K-Ruoka's raw search payload onto our domain model.
 *
 * Written defensively on purpose: this is an undocumented internal API, so every
 * field is treated as possibly-missing. A product we cannot price is dropped
 * rather than surfaced with a wrong number — a missing item is a visible bug,
 * a silently wrong price is not.
 */

// The upstream payload is untyped JSON; these aliases keep the parsing honest
// without pretending we have a contract.
type Json = Record<string, unknown>;

function obj(value: unknown): Json | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Json)
    : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function toQtyUnit(raw: unknown): QtyUnit {
  const s = str(raw)?.toLowerCase();
  if (s === "kg") return "kg";
  if (s === "l" || s === "ltr") return "l";
  return "kpl";
}

function toSoldBy(raw: unknown): SoldBy {
  const s = str(raw);
  if (s === "mass") return "mass";
  if (s === "approximatePiece") return "approximatePiece";
  return "piece";
}

/** Rounds to cents so repeated arithmetic can't drift into 0.30000000000000004. */
export function toCents(euros: number): number {
  return Math.round(euros * 100);
}

export function centsToEuros(cents: number): number {
  return Math.round(cents) / 100;
}

/**
 * Parses one pricing variant.
 *
 * `batch` offers carry `amount: 2` with `price` being the bundle total, so the
 * per-unit figure has to be derived. Everything else implies `amount: 1`.
 */
function parseOffer(kind: OfferKind, raw: unknown): PriceOffer | null {
  const o = obj(raw);
  if (!o) return null;

  const price = num(o.price);
  if (price === null) return null;

  const amount = num(o.amount) ?? 1;
  if (amount <= 0) return null;

  const unitPrice = obj(o.unitPrice);
  const soldBy = obj(o.soldBy);

  return {
    kind,
    price,
    amount,
    // The whole reason this layer exists: "2 for 4,50" becomes 2,25 each.
    effectiveUnitPrice: centsToEuros(toCents(price) / amount),
    unit: toQtyUnit(o.unit),
    comparisonPrice: unitPrice ? num(unitPrice.value) : null,
    comparisonUnit: unitPrice ? str(unitPrice.unit) : null,
    isApproximate: o.isApproximate === true || toSoldBy(soldBy?.kind) === "approximatePiece",
    discountPercent: num(o.discountPercentage),
    discountType: str(o.discountType),
    validUntil: str(o.endDate),
  };
}

function parsePricing(raw: unknown): ProductPricing | null {
  const pricing = obj(raw);
  if (!pricing) return null;

  const normal = parseOffer("normal", pricing.normal);
  if (!normal) return null;

  const offers: PriceOffer[] = [normal];
  const discount = parseOffer("discount", pricing.discount);
  if (discount) offers.push(discount);
  const batch = parseOffer("batch", pricing.batch);
  if (batch) offers.push(batch);

  const best = offers.reduce((cheapest, offer) =>
    offer.effectiveUnitPrice < cheapest.effectiveUnitPrice ? offer : cheapest,
  );

  return { normal, best, offers };
}

/** Maps one entry of the upstream `result` array. Returns null if unusable. */
export function normalizeProduct(raw: unknown, fallbackStoreId: string): Product | null {
  const entry = obj(raw);
  const product = obj(entry?.product);
  if (!product) return null;

  const ean = str(product.ean);
  const id = str(product.id) ?? ean;
  if (!ean || !id) return null;

  const pricing = parsePricing(obj(product.mobilescan)?.pricing);
  if (!pricing) return null;

  const attrs = obj(product.productAttributes);
  const names = obj(product.localizedName);
  const name = str(names?.finnish) ?? str(names?.swedish) ?? str(names?.english);
  if (!name) return null;

  const category = obj(product.category);
  const tree = Array.isArray(category?.tree) ? category.tree : [];
  // The top level is the department shopping mode groups by. The leaf
  // ("Mozzarella") is so fine-grained that nearly every item became its own
  // group, and `category.order` is a per-leaf index on a different scale from
  // the aisle order the other sources use.
  const top = obj(tree[0]);
  const categoryPath = str(category?.path);

  const measurements = obj(attrs?.measurements);
  const soldByRaw = obj(obj(obj(product.mobilescan)?.pricing)?.normal)?.soldBy;

  const images = Array.isArray(product.images) ? product.images : [];

  return {
    id,
    ean,
    storeId: str(obj(product.store)?.id) ?? fallbackStoreId,
    isLocal: obj(product.store)?.isLocal === true,
    name,
    nameSv: str(names?.swedish),
    nameEn: str(names?.english),
    brand: str(obj(product.brand)?.name),
    categoryPath,
    categoryName: str(obj(top?.localizedName)?.finnish) ?? departmentNameForSlug(categoryPath),
    section: str(product.section) ?? str(attrs?.section),
    categoryOrder: categoryPath ? aisleOrderForSlug(categoryPath) : null,
    imageUrl: str(images[0]) ?? str(obj(attrs?.image)?.url),
    originCountry: str(obj(attrs?.origin)?.countryOfOrigin),
    contentSize: measurements ? num(measurements.contentSize) : null,
    contentUnit: measurements ? str(measurements.contentUnit) : null,
    soldBy: toSoldBy(obj(soldByRaw)?.kind),
    averageWeight:
      num(obj(soldByRaw)?.averageWeight) ?? (measurements ? num(measurements.averageWeight) : null),
    isAvailable: product.isAvailable !== false,
    popularity: num(product.popularity) ?? 0,
    pricing,
  };
}

/** Maps a full search response, skipping entries that fail to parse. */
export function normalizeSearchResponse(raw: unknown, storeId: string): Product[] {
  const body = obj(raw);
  const results = Array.isArray(body?.result) ? body.result : [];
  const products: Product[] = [];
  for (const entry of results) {
    const product = normalizeProduct(entry, storeId);
    if (product) products.push(product);
  }
  return products;
}

/**
 * Cost of buying `qty` units at the best available price.
 *
 * Batch offers only apply to complete bundles: buying 3 of a "2 for 4,50" deal
 * charges the bundle price once plus a single unit at the normal price. Getting
 * this wrong under-reports the total, which is the direction that annoys people
 * at the checkout, so it is modelled explicitly.
 */
export function lineTotal(pricing: ProductPricing, qty: number): number {
  if (qty <= 0) return 0;

  const best = pricing.best;
  if (best.kind !== "batch" || best.amount <= 1) {
    return centsToEuros(toCents(best.effectiveUnitPrice) * qty);
  }

  const bundles = Math.floor(qty / best.amount);
  const remainder = qty - bundles * best.amount;
  const cents = bundles * toCents(best.price) + remainder * toCents(pricing.normal.price);
  return centsToEuros(cents);
}
