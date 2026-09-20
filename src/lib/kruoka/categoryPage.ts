import { aisleOrderForSlug } from "./aisles";

/**
 * Extraction for K-Ruoka category pages.
 *
 * Why this exists: the internal `/kr-api/` endpoint answers server-side
 * callers with 403, and so does a plain Node fetch of any page on the domain —
 * that is TLS-level client fingerprinting, not a header we are missing. The
 * only way the app can read this data is through a real browser, so ingestion
 * drives Chromium (see `scripts/ingest-catalogue.ts`) and this module holds
 * the parsing, which is testable on its own.
 *
 * What it reads is the public category listing — no login, no `?haku=` search
 * URLs (robots.txt disallows those), just the pages a shopper browses.
 */

/** Top-level category pages to ingest, in shop order. */
export const INGEST_CATEGORIES: readonly string[] = [
  "hedelmat-ja-vihannekset",
  "leivat-keksit-ja-leivonnaiset",
  "liha-ja-kasviproteiinit",
  "kala-ja-merenelavat",
  "valmisruoka",
  "maito-juusto-munat-ja-rasvat",
  "kuivat-elintarvikkeet-ja-leivonta",
  "sailykkeet-keitot-ja-ateria-ainekset",
  "pakasteet",
  "makeiset-ja-naposteltavat",
  "juomat",
  "kodinhoito-ja-taloustarvikkeet",
];

export interface ScrapedProduct {
  ean: string;
  slug: string;
  name: string;
  priceCents: number;
  unit: string;
  categorySlug: string;
  categoryName: string;
  categoryOrder: number;
}

/** A product card as read out of the DOM, before validation. */
export interface RawCard {
  href: string;
  name: string;
  cardText: string;
}

/**
 * Pulls the EAN out of a product URL.
 *
 * Store-local products carry a `-nNNN` store suffix after the EAN; it is
 * dropped so the product keys the same way national ones do.
 */
export function eanFromHref(href: string): { ean: string; slug: string } | null {
  const match = href.match(/\/kauppa\/tuote\/([^/?#]+)/);
  const slug = match?.[1];
  if (!slug) return null;

  const ean = slug.replace(/-n\d+$/i, "").match(/(\d{8,14})$/)?.[1];
  return ean ? { ean, slug } : null;
}

/**
 * Reads the price off a card.
 *
 * Cards show either a plain price ("Hinta 2,39 € kappale") or a loyalty-card
 * offer, in which case the shelf price appears as "Ilman Plussa-korttia".
 * The shelf price is preferred: it is what someone without the card pays, and
 * quoting a card price as the total would understate the bill.
 */
export function parseCardPrice(cardText: string): { cents: number; unit: string } | null {
  const flat = cardText.replace(/\s+/g, " ");

  const withoutCard = flat.match(/Ilman Plussa-korttia (\d+),(\d+) € (kappale|kilogramma|litra)/);
  const plain = flat.match(/Hinta(?: noin)? (\d+),(\d+) € (kappale|kilogramma|litra)/);
  const match = withoutCard ?? plain;
  if (!match) return null;

  const euros = Number.parseInt(match[1]!, 10);
  const cents = Number.parseInt(match[2]!, 10);
  const unitWord = match[3];

  return {
    cents: euros * 100 + cents,
    unit: unitWord === "kilogramma" ? "kg" : unitWord === "litra" ? "l" : "kpl",
  };
}

/** Turns raw cards into products, dropping anything unusable. */
export function parseCategoryCards(
  cards: RawCard[],
  categorySlug: string,
  categoryName: string,
): ScrapedProduct[] {
  const seen = new Set<string>();
  const out: ScrapedProduct[] = [];
  const categoryOrder = aisleOrderForSlug(categorySlug);

  for (const card of cards) {
    const id = eanFromHref(card.href);
    if (!id || seen.has(id.ean)) continue;

    const name = card.name.trim().split("\n")[0]?.trim();
    if (!name) continue;

    const price = parseCardPrice(card.cardText);
    // A product with no readable price cannot contribute to a total.
    if (!price) continue;

    seen.add(id.ean);
    out.push({
      ean: id.ean,
      slug: id.slug,
      name,
      priceCents: price.cents,
      unit: price.unit,
      categorySlug,
      categoryName,
      categoryOrder,
    });
  }

  return out;
}

/** Product image URLs are derived from the EAN rather than scraped. */
export function imageUrlForEan(ean: string): string {
  return `https://public.keskofiles.com/f/k-ruoka/product/${ean}`;
}
