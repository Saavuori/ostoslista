import { aisleOrderForSlug, slugFromCategoryUrl } from "./aisles";
import type { PriceOffer, Product, SoldBy } from "./types";

/**
 * Reads a product from its public K-Ruoka page.
 *
 * This is the supported way in: product pages are listed in the sitemap and
 * permitted by robots.txt, and they carry schema.org JSON-LD — structured data
 * published specifically so machines can read it. The internal `/kr-api/`
 * endpoint, by contrast, answers server-side callers with 403.
 *
 * Practical differences from the internal API, worth knowing:
 *
 * - The page shows one store's price (the seller named in the offer), not an
 *   arbitrary store's. Per-store pricing is not available this way.
 * - There are no Plussa campaign or multi-buy offers here, only the shelf
 *   price. `pricing.best` therefore equals `pricing.normal`.
 */

const BASE = "https://www.k-ruoka.fi";

/** Looks like a browser because the CDN rejects obviously scripted clients. */
const HEADERS: HeadersInit = {
  Accept: "text/html,application/xhtml+xml",
  "Accept-Language": "fi-FI,fi;q=0.9",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
};

const LD_JSON = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;

type Json = Record<string, unknown>;

const obj = (v: unknown): Json | null =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Json) : null;
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** `ct` means "count", i.e. sold by the piece; `kg`/`ltr` are weighed goods. */
function soldByFromUnitCode(code: string | null): SoldBy {
  if (code === "kg" || code === "ltr" || code === "LTR" || code === "KGM") return "mass";
  return "piece";
}

function unitFromCode(code: string | null): PriceOffer["unit"] {
  if (code === "kg" || code === "KGM") return "kg";
  if (code === "ltr" || code === "LTR") return "l";
  return "kpl";
}

/** Pulls every JSON-LD node out of a page, flattening `@graph` containers. */
export function extractLdNodes(html: string): Json[] {
  const nodes: Json[] = [];

  for (const match of html.matchAll(LD_JSON)) {
    const raw = match[1];
    if (!raw) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // A malformed block on one page must not break the whole parse.
      continue;
    }

    const push = (value: unknown) => {
      const node = obj(value);
      if (!node) return;
      const graph = node["@graph"];
      if (Array.isArray(graph)) {
        for (const child of graph) push(child);
        return;
      }
      nodes.push(node);
    };

    if (Array.isArray(parsed)) for (const entry of parsed) push(entry);
    else push(parsed);
  }

  return nodes;
}

/** Maps a page's JSON-LD onto our domain model. Null if it is not a product. */
export function parseProductPage(html: string, storeId: string): Product | null {
  const nodes = extractLdNodes(html);

  const productNode = nodes.find((node) => node["@type"] === "Product");
  if (!productNode) return null;

  const ean = str(productNode.gtin13) ?? str(productNode.productID);
  const name = str(productNode.name);
  if (!ean || !name) return null;

  const offer = obj(productNode.offers);
  const spec = obj(offer?.priceSpecification);
  const price = num(spec?.price);
  // A product with no price is not usable on a list that shows totals.
  if (price === null) return null;

  const reference = obj(spec?.referenceQuantity);
  const unitCode = str(reference?.unitCode);
  const soldBy = soldByFromUnitCode(unitCode);
  const unit = unitFromCode(unitCode);

  const weight = obj(productNode.weight);
  const contentSize = num(weight?.value);
  const contentUnit = str(weight?.unitText);

  // The deepest breadcrumb is the specific category; the first is the aisle.
  const breadcrumb = nodes.find((node) => node["@type"] === "BreadcrumbList");
  const crumbs = Array.isArray(breadcrumb?.itemListElement) ? breadcrumb.itemListElement : [];
  const items = crumbs
    .map((crumb) => obj(obj(crumb)?.item))
    .filter((item): item is Json => item !== null);

  const topSlug = slugFromCategoryUrl(str(items[0]?.["@id"]));
  const leaf = items.at(-1);

  const images = Array.isArray(productNode.image) ? productNode.image : [];

  const normal: PriceOffer = {
    kind: "normal",
    price,
    amount: 1,
    effectiveUnitPrice: price,
    unit,
    // Only a shelf price is published here; there is no comparison price.
    comparisonPrice: soldBy === "mass" ? price : null,
    comparisonUnit: soldBy === "mass" ? unit : null,
    isApproximate: false,
    discountPercent: null,
    discountType: null,
    validUntil: null,
  };

  return {
    id: ean,
    ean,
    storeId,
    isLocal: false,
    name,
    nameSv: null,
    nameEn: null,
    brand: str(obj(productNode.brand)?.name),
    categoryPath: topSlug,
    // The aisle heading people recognise is the top-level category.
    categoryName: str(items[0]?.name) ?? str(leaf?.name),
    section: null,
    categoryOrder: aisleOrderForSlug(topSlug),
    imageUrl: str(images[0]) ?? str(productNode.image),
    originCountry: null,
    contentSize,
    contentUnit,
    soldBy,
    averageWeight: null,
    isAvailable: str(offer?.availability)?.includes("InStock") !== false,
    popularity: 0,
    pricing: { normal, best: normal, offers: [normal] },
  };
}

export class ProductPageError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = "ProductPageError";
  }
}

export interface FetchOptions {
  fetchImpl?: typeof fetch;
  storeId?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/** Fetches and parses one product page by its URL slug. */
export async function fetchProductBySlug(
  slug: string,
  options: FetchOptions = {},
): Promise<Product | null> {
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  const timeout = AbortSignal.timeout(options.timeoutMs ?? 12_000);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;

  let response: Response;
  try {
    response = await doFetch(`${BASE}/kauppa/tuote/${slug}`, {
      headers: HEADERS,
      signal,
      cache: "no-store",
    });
  } catch (cause) {
    throw new ProductPageError(`product page unreachable: ${String(cause)}`, null);
  }

  // A delisted product 404s; that is information, not a failure.
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new ProductPageError(`product page returned ${response.status}`, response.status);
  }

  return parseProductPage(await response.text(), options.storeId ?? "default");
}
