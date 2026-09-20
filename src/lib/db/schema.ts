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
