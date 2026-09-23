import { relations, sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  numeric,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

/**
 * Schema notes that apply throughout:
 *
 * - Ids are UUIDv7, generated on the CLIENT. An offline device must be able to
 *   create a row without asking the server for an id, and v7 sorts by creation
 *   time so natural ordering comes free.
 * - Rows are never hard-deleted. A hard delete that syncs after an offline edit
 *   resurrects the row; a tombstone does not.
 * - `updatedAt` / `updatedBy` exist for last-write-wins reconciliation.
 */

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
};

/** A shopping list. The unit of sharing. */
export const lists = pgTable(
  "lists",
  {
    id: uuid("id").primaryKey(),
    name: varchar("name", { length: 120 }).notNull(),
    /**
     * Which K-Ruoka store's prices this list uses.
     *
     * Deliberately per-list rather than per-member: everyone looking at the
     * list sees the same total, which is the only way the number means anything
     * when two people are discussing it.
     */
    storeId: varchar("store_id", { length: 16 }).notNull().default("N106"),
    /** Denormalised for the list index; kept in sync by the service layer. */
    itemCount: integer("item_count").notNull().default(0),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [index("lists_updated_idx").on(table.updatedAt)],
);

/**
 * A share link.
 *
 * Holding the token IS the credential — there is no account requirement,
 * because making someone sign up before they can add milk to a list is how
 * these apps die. Tokens are revocable and optionally expiring.
 */
export const shareTokens = pgTable(
  "share_tokens",
  {
    token: varchar("token", { length: 32 }).primaryKey(),
    listId: uuid("list_id")
      .notNull()
      .references(() => lists.id, { onDelete: "cascade" }),
    /** "editor" can change items; "viewer" is read-only. */
    role: varchar("role", { length: 16 }).notNull().default("editor"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (table) => [index("share_tokens_list_idx").on(table.listId)],
);

/**
 * Someone participating in a list.
 *
 * Identity is a nickname plus a device-held id. This is intentionally weak:
 * it exists to attribute changes and show presence, not to protect anything.
 * Access control is the share token.
 */
export const listMembers = pgTable(
  "list_members",
  {
    id: uuid("id").primaryKey(),
    listId: uuid("list_id")
      .notNull()
      .references(() => lists.id, { onDelete: "cascade" }),
    nickname: varchar("nickname", { length: 40 }).notNull(),
    role: varchar("role", { length: 16 }).notNull().default("editor"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("list_members_unique").on(table.listId, table.id)],
);

/**
 * One line on a list.
 *
 * An item is either a catalogue product (`ean` set) or free text
 * ("jotain jälkiruoaksi"). Both are first class — a list that only accepts
 * scannable products is not a list people will actually use.
 */
export const listItems = pgTable(
  "list_items",
  {
    id: uuid("id").primaryKey(),
    listId: uuid("list_id")
      .notNull()
      .references(() => lists.id, { onDelete: "cascade" }),

    /** Set when this line refers to a catalogue product. */
    ean: varchar("ean", { length: 20 }),
    /** Set when it does not. Exactly one of `ean` / `freeText` is present. */
    freeText: varchar("free_text", { length: 200 }),

    /**
     * Snapshot of the product name at the time it was added, so an item still
     * reads correctly when the catalogue is unavailable or the product is gone.
     */
    nameSnapshot: varchar("name_snapshot", { length: 200 }),
    /** Snapshot of the unit price in cents, for offline totals. */
    priceCentsSnapshot: integer("price_cents_snapshot"),

    /**
     * Snapshot of where the product lives in the shop.
     *
     * Snapshotted rather than joined from `products` so shopping mode still
     * groups correctly with no connection — which is precisely when it is
     * being used.
     */
    aisleName: varchar("aisle_name", { length: 120 }),
    aisleOrder: integer("aisle_order"),

    /**
     * The rest of what the search result showed.
     *
     * Snapshotted for the same reason as everything above: the shop is where
     * this information matters and the shop is where there is no signal. A
     * picture is how you recognise the product on a shelf, and the offer is
     * what tells you to pick up two instead of one.
     */
    imageUrl: varchar("image_url", { length: 400 }),
    /** Comparison price in cents, e.g. 750 with unit "kg" for 7,50 €/kg. */
    comparisonCents: integer("comparison_cents"),
    comparisonUnit: varchar("comparison_unit", { length: 8 }),
    /** Campaign, if any. `discountType` is usually "PLUSSA" — card required. */
    discountPercent: integer("discount_percent"),
    discountType: varchar("discount_type", { length: 24 }),
    /** Multi-buy: units needed and the bundle price, for "2 kpl 4,50 €". */
    offerAmount: integer("offer_amount"),
    offerBundleCents: integer("offer_bundle_cents"),

    /**
     * Where this product sits in the list's own store: "hylly 06, taso 5".
     * Filled in by the server after the item is added (see `lists/locate.ts`),
     * which also replaces `aisleName`/`aisleOrder` with the store's department.
     */
    shelfModule: varchar("shelf_module", { length: 8 }),
    shelfLevel: varchar("shelf_level", { length: 8 }),
    /** When the store location was looked up; null means not yet tried. */
    locatedAt: timestamp("located_at", { withTimezone: true }),

    /** Numeric, not integer: 0.4 kg of salmon is a valid quantity. */
    qty: numeric("qty", { precision: 10, scale: 3 }).notNull().default("1"),
    qtyUnit: varchar("qty_unit", { length: 8 }).notNull().default("kpl"),

    note: varchar("note", { length: 200 }),

    checked: boolean("checked").notNull().default(false),
    checkedBy: uuid("checked_by"),
    checkedAt: timestamp("checked_at", { withTimezone: true }),

    /** Manual ordering within the list; aisle mode sorts by section instead. */
    sortKey: numeric("sort_key", { precision: 20, scale: 6 }).notNull().default("0"),

    addedBy: uuid("added_by"),
    /** Who last wrote this row — the tiebreaker half of last-write-wins. */
    updatedBy: uuid("updated_by"),

    ...timestamps,
  },
  (table) => [
    index("list_items_list_idx").on(table.listId),
    // Partial index: the shopping view only ever reads live rows.
    index("list_items_live_idx")
      .on(table.listId, table.sortKey)
      .where(sql`${table.deletedAt} is null`),
  ],
);

export const listsRelations = relations(lists, ({ many }) => ({
  items: many(listItems),
  members: many(listMembers),
  tokens: many(shareTokens),
}));

export const listItemsRelations = relations(listItems, ({ one }) => ({
  list: one(lists, { fields: [listItems.listId], references: [lists.id] }),
}));

export const shareTokensRelations = relations(shareTokens, ({ one }) => ({
  list: one(lists, { fields: [shareTokens.listId], references: [lists.id] }),
}));

export const listMembersRelations = relations(listMembers, ({ one }) => ({
  list: one(lists, { fields: [listMembers.listId], references: [lists.id] }),
}));

export type List = typeof lists.$inferSelect;
export type NewList = typeof lists.$inferInsert;
export type ListItem = typeof listItems.$inferSelect;
export type NewListItem = typeof listItems.$inferInsert;
export type ShareToken = typeof shareTokens.$inferSelect;
export type ListMember = typeof listMembers.$inferSelect;

/** Text used in the UI. Kept here so the DB and the client agree. */
export const ITEM_ROLES = ["editor", "viewer"] as const;
export type Role = (typeof ITEM_ROLES)[number];

/**
 * Cached product identity.
 *
 * Keyed by EAN and shared across every store, because a product's name, brand,
 * picture and category do not vary by shop — only its price does. This is the
 * long-lived half of the cache.
 *
 * Nothing here is ever committed to the repository: it is Kesko's data, cached
 * for the lists people actually keep. See AGENTS.md.
 */
export const products = pgTable(
  "products",
  {
    ean: varchar("ean", { length: 20 }).primaryKey(),
    name: varchar("name", { length: 200 }).notNull(),
    /** URL slug for the public product page — how a price is fetched. */
    slug: varchar("slug", { length: 300 }),
    /** Lowercased name, indexed for prefix and substring search. */
    searchName: varchar("search_name", { length: 200 }),
    nameSv: varchar("name_sv", { length: 200 }),
    brand: varchar("brand", { length: 120 }),
    categoryPath: varchar("category_path", { length: 200 }),
    categoryName: varchar("category_name", { length: 120 }),
    /** Store department code — the closest thing to a physical aisle. */
    section: varchar("section", { length: 16 }),
    categoryOrder: integer("category_order"),
    imageUrl: varchar("image_url", { length: 400 }),
    originCountry: varchar("origin_country", { length: 8 }),
    contentSize: numeric("content_size", { precision: 10, scale: 3 }),
    contentUnit: varchar("content_unit", { length: 8 }),
    /** "piece" | "mass" | "approximatePiece" */
    soldBy: varchar("sold_by", { length: 20 }).notNull().default("piece"),
    averageWeight: numeric("average_weight", { precision: 10, scale: 3 }),
    popularity: numeric("popularity", { precision: 12, scale: 3 }).notNull().default("0"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("products_name_idx").on(table.name),
    // Drives autocomplete; search runs entirely against this table.
    index("products_search_idx").on(table.searchName),
  ],
);

/**
 * Cached price for one product in one store.
 *
 * The short-lived half of the cache. Prices are per-store, so this table is
 * refreshed on a TTL and only for products someone has on a list — never by
 * crawling the whole assortment.
 *
 * `best*` columns hold the cheapest offer already resolved, so reading a list
 * total never has to re-derive it. Money is stored in cents.
 */
export const storePrices = pgTable(
  "store_prices",
  {
    ean: varchar("ean", { length: 20 }).notNull(),
    storeId: varchar("store_id", { length: 16 }).notNull(),

    /** Shelf price with no card and no campaign. */
    normalCents: integer("normal_cents").notNull(),
    unit: varchar("unit", { length: 8 }).notNull().default("kpl"),

    /** Cheapest offer, per single unit. */
    bestUnitCents: integer("best_unit_cents").notNull(),
    /** "normal" | "discount" | "batch" */
    bestKind: varchar("best_kind", { length: 16 }).notNull().default("normal"),
    /** Units you must buy for `bestBundleCents`; 1 unless it is a multi-buy. */
    bestAmount: integer("best_amount").notNull().default(1),
    /** What the till charges for `bestAmount` units. */
    bestBundleCents: integer("best_bundle_cents").notNull(),

    /** Comparison price per kg/l, in cents. */
    comparisonCents: integer("comparison_cents"),
    comparisonUnit: varchar("comparison_unit", { length: 8 }),

    discountPercent: integer("discount_percent"),
    discountType: varchar("discount_type", { length: 24 }),
    validUntil: timestamp("valid_until", { withTimezone: true }),

    isAvailable: boolean("is_available").notNull().default(true),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("store_prices_pk").on(table.ean, table.storeId),
    index("store_prices_stale_idx").on(table.fetchedAt),
  ],
);

/**
 * Where a product sits in one store: department, shelf module and level.
 *
 * Per store, because every K-store has its own layout. Planograms change far
 * less often than prices, so rows live for days rather than hours. A row with
 * no department records that the store has no location for the product, so it
 * is not asked again on every list load.
 */
export const storeLocations = pgTable(
  "store_locations",
  {
    ean: varchar("ean", { length: 20 }).notNull(),
    storeId: varchar("store_id", { length: 16 }).notNull(),
    departmentName: varchar("department_name", { length: 120 }),
    /** The store's own department sequence (Iso Omena: produce ~117 … beer 6). */
    departmentOrder: integer("department_order"),
    module: varchar("module", { length: 8 }),
    level: varchar("level", { length: 8 }),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("store_locations_pk").on(table.ean, table.storeId)],
);

export type Product = typeof products.$inferSelect;
export type StorePrice = typeof storePrices.$inferSelect;
