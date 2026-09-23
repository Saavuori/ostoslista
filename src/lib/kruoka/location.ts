/**
 * Where a product sits in one store, from `GET /kr-api/v4/products/<ean>`.
 *
 * The same panel K-Ruoka's product page shows as "Osasto / Hylly / Taso".
 * Upstream shape, trimmed:
 *
 *   { product: { location: { module: "05", level: "1",
 *       department: { id: "219", name: "Juusto", orderNumber: 97 } } } }
 */
export interface StoreLocation {
  /** The store's own department heading, e.g. "Juusto". */
  departmentName: string;
  /** The store's department sequence; produce is high, beer and cleaning low. */
  departmentOrder: number;
  /** Shelf module ("hylly"), e.g. "05". */
  module: string | null;
  /** Shelf level ("taso"), e.g. "1". */
  level: string | null;
}

type Json = Record<string, unknown>;
const obj = (value: unknown): Json | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : null;
const str = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

/**
 * Reads the location out of a v4 product response.
 *
 * Null when the store has none for this product — local items, things not on
 * its planogram — or when the department is not meant to be shown.
 */
export function normalizeLocation(body: unknown): StoreLocation | null {
  const location = obj(obj(obj(body)?.product)?.location);
  const department = obj(location?.department);
  const departmentName = str(department?.name);
  const departmentOrder = department?.orderNumber;

  if (!departmentName || typeof departmentOrder !== "number" || !Number.isFinite(departmentOrder)) {
    return null;
  }
  if (department?.isPublic === false) return null;

  return {
    departmentName: departmentName.slice(0, 120),
    departmentOrder: Math.trunc(departmentOrder),
    module: str(location?.module)?.slice(0, 8) ?? null,
    level: str(location?.level)?.slice(0, 8) ?? null,
  };
}
