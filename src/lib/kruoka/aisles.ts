/**
 * Aisle ordering.
 *
 * K-Ruoka's category sitemap lists top-level categories in site order, which
 * tracks the order you walk a shop: produce first, household goods last. That
 * ordering is what shopping mode sorts by.
 *
 * Captured from `sitemap-https-product-categories-1.xml`. It changes rarely;
 * an unknown slug simply sorts last rather than breaking grouping.
 */
const AISLE_ORDER: readonly string[] = [
  "hedelmat-ja-vihannekset",
  "leivat-keksit-ja-leivonnaiset",
  "liha-ja-kasviproteiinit",
  "kala-ja-merenelavat",
  "valmisruoka",
  "maito-juusto-munat-ja-rasvat",
  "kuivat-elintarvikkeet-ja-leivonta",
  "sailykkeet-keitot-ja-ateria-ainekset",
  "oljyt-etikat-ja-salaattikastikkeet",
  "mausteet-ja-maustaminen",
  "texmex-ja-maailman-maut",
  "pakasteet",
  "makeiset-ja-naposteltavat",
  "juomat",
  "lapset",
  "lemmikit",
  "kosmetiikka-terveys-ja-hygienia",
  "kahvilatuotteet",
  "keittio-astiat-ja-kattaus",
  "kodinhoito-ja-taloustarvikkeet",
  "kodintekstiilit-ja-sisustus",
  "kodinkoneet-ja-elektroniikka",
  "sahko-pienrauta-ja-autotarvikkeet",
  "kukat-ja-puutarha",
  "vapaa-aika-ja-urheilu",
  "kirjat-lehdet-ja-paperitarvikkeet",
  "kengat-ja-kenkienhoito",
  "vaatteet-ja-asusteet",
  "autopesu",
];

const ORDER_BY_SLUG = new Map(AISLE_ORDER.map((slug, index) => [slug, (index + 1) * 10]));

/** Sorts after every known aisle, without colliding with one. */
const UNKNOWN_ORDER = (AISLE_ORDER.length + 1) * 10;

/**
 * Position of a top-level category.
 *
 * Takes the slug from a breadcrumb URL, e.g.
 * ".../tuotehaku/kala-ja-merenelavat/tuorekala" -> "kala-ja-merenelavat".
 */
export function aisleOrderForSlug(slug: string | null): number {
  if (!slug) return UNKNOWN_ORDER;
  const top = slug.split("/")[0] ?? "";
  return ORDER_BY_SLUG.get(top) ?? UNKNOWN_ORDER;
}

/** Extracts the category slug from a K-Ruoka breadcrumb URL. */
export function slugFromCategoryUrl(url: string | null): string | null {
  if (!url) return null;
  const match = url.match(/\/kauppa\/tuotehaku\/(.+?)\/?$/);
  return match?.[1] ?? null;
}
