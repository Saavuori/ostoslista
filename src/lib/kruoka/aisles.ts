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

/**
 * Display names of the top-level categories — the departments shopping mode
 * groups by.
 *
 * Every source of product data (live search, product pages, the seed import)
 * must produce the same heading for the same department, or one department
 * splits into two groups. The API's own `category.tree[0]` name is preferred;
 * this table is the fallback when only a slug is known, and is what the
 * `0005` data migration used.
 *
 * Copied verbatim from the API's `tree[0].localizedName.finnish`, 2026-09-23.
 * The three slugs missing here (kahvilatuotteet, sahko-pienrauta-ja-
 * autotarvikkeet, autopesu) never appeared in search results.
 */
export const DEPARTMENT_NAMES: Readonly<Record<string, string>> = {
  "hedelmat-ja-vihannekset": "Hedelmät ja vihannekset",
  "leivat-keksit-ja-leivonnaiset": "Leivät, keksit ja leivonnaiset",
  "liha-ja-kasviproteiinit": "Liha ja kasviproteiinit",
  "kala-ja-merenelavat": "Kala ja merenelävät",
  valmisruoka: "Valmisruoka",
  "maito-juusto-munat-ja-rasvat": "Maito, juusto, munat ja rasvat",
  "kuivat-elintarvikkeet-ja-leivonta": "Kuivat elintarvikkeet ja leivonta",
  "sailykkeet-keitot-ja-ateria-ainekset": "Säilykkeet, keitot ja ateria-ainekset",
  "oljyt-etikat-ja-salaattikastikkeet": "Öljyt, etikat ja salaattikastikkeet",
  "mausteet-ja-maustaminen": "Mausteet ja maustaminen",
  "texmex-ja-maailman-maut": "Texmex ja maailman maut",
  pakasteet: "Pakasteet",
  "makeiset-ja-naposteltavat": "Makeiset ja naposteltavat",
  juomat: "Juomat",
  lapset: "Lapset",
  lemmikit: "Lemmikit",
  "kosmetiikka-terveys-ja-hygienia": "Kosmetiikka, terveys ja hygienia",
  "keittio-astiat-ja-kattaus": "Keittiö, astiat ja kattaus",
  "kodinhoito-ja-taloustarvikkeet": "Kodinhoito ja taloustarvikkeet",
  "kodintekstiilit-ja-sisustus": "Sisustus ja kodintekstiilit",
  "kodinkoneet-ja-elektroniikka": "Kodinkoneet ja elektroniikka",
  "kukat-ja-puutarha": "Kukat ja puutarha",
  "vapaa-aika-ja-urheilu": "Vapaa-aika ja urheilu",
  "kirjat-lehdet-ja-paperitarvikkeet": "Kirjat, lehdet ja paperitarvikkeet",
  "kengat-ja-kenkienhoito": "Kengät ja kenkienhoito",
  "vaatteet-ja-asusteet": "Vaatteet ja asusteet",
};

/**
 * Aisle order for a department from the store's own layout.
 *
 * The store numbers its departments with fresh produce high (Iso Omena:
 * "Hevi" ~117) and beer and household low (~6-30), so walking the shop means
 * descending order — hence the negation. Negative also keeps every
 * store-located group ahead of items that only have the web category
 * (`aisleOrderForSlug`, 10…300), which are ordered on a different scale.
 */
export function storeAisleOrder(departmentOrder: number): number {
  return -departmentOrder;
}

/** Department name for a slug or slug path, e.g. "pakasteet/jaatelot" -> "Pakasteet". */
export function departmentNameForSlug(slug: string | null): string | null {
  if (!slug) return null;
  const top = slug.split("/")[0] ?? "";
  return DEPARTMENT_NAMES[top] ?? null;
}

/** Extracts the category slug from a K-Ruoka breadcrumb URL. */
export function slugFromCategoryUrl(url: string | null): string | null {
  if (!url) return null;
  const match = url.match(/\/kauppa\/tuotehaku\/(.+?)\/?$/);
  return match?.[1] ?? null;
}
