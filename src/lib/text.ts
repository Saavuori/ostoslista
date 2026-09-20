/**
 * Finnish text handling for search.
 *
 * People type "leipa" and expect to find "leipä". Finnish keyboards have the
 * umlauts, but phone typing, haste and habit mean the folded form is common —
 * and a search that returns nothing for "leipa" reads as broken.
 *
 * Folding is used only for matching, never for display: the product is still
 * shown with its real name.
 */

/**
 * Lowercases and strips the diacritics Finnish search needs folded.
 *
 * Deliberately limited to ä/ö/å (plus the Swedish and loan-word forms that
 * turn up in product names). It is not a general Unicode normalisation: "š"
 * in "Tšaikovski" folding to "s" is fine, but nothing here should change the
 * meaning of a Finnish word.
 */
export function foldFinnish(value: string): string {
  return (
    value
      .toLowerCase()
      .normalize("NFD")
      // Strip combining marks left by the decomposition.
      .replace(/[̀-ͯ]/g, "")
      .normalize("NFC")
  );
}

/** Prepares a user query for matching against a folded name. */
export function normalizeQuery(value: string): string {
  return foldFinnish(value.trim()).replace(/\s+/g, " ");
}
