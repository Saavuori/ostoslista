import { z } from "zod";

/**
 * Request schemas.
 *
 * These are the trust boundary: ids and sort keys are client-generated, so
 * everything crossing the wire is validated rather than assumed well-formed.
 */

const uuid = z.string().uuid();

/** Quantities are numeric with a unit — 0.4 kg of salmon is valid input. */
const qty = z
  .number()
  .positive("Määrän pitää olla suurempi kuin nolla")
  .max(9999, "Määrä on liian suuri")
  .multipleOf(0.001, "Määrässä voi olla enintään kolme desimaalia");

const qtyUnitSchema = z.enum(["kpl", "kg", "l"]);

/**
 * Ordering key.
 *
 * Bounded to what `numeric(20, 6)` can hold. Without this, a client sending
 * Number.MAX_SAFE_INTEGER overflows the column and fails the whole batch at
 * the database rather than being rejected cleanly here.
 */
const sortKeySchema = z
  .number()
  .finite()
  .min(-1e13, "Järjestysarvo on alueen ulkopuolella")
  .max(1e13, "Järjestysarvo on alueen ulkopuolella");

export const createListSchema = z.object({
  id: uuid.optional(),
  name: z.string().trim().min(1, "Anna listalle nimi").max(120),
  storeId: z
    .string()
    .trim()
    .regex(/^[A-Z0-9]{2,16}$/, "Virheellinen myymälätunnus")
    .optional(),
  nickname: z.string().trim().min(1).max(40).optional(),
});

/**
 * What a row is and what the search result showed about it. Sent when a row is
 * created — online through `createItemSchema`, or offline through the sync
 * batch — so both paths validate it identically.
 */
const itemContentSchema = z.object({
  ean: z
    .string()
    .regex(/^\d{8,14}$/, "Virheellinen EAN-koodi")
    .nullish(),
  freeText: z.string().trim().min(1).max(200).nullish(),
  nameSnapshot: z.string().trim().min(1).max(200).nullish(),
  priceCentsSnapshot: z.number().int().min(0).max(10_000_000).nullish(),
  aisleName: z.string().trim().min(1).max(120).nullish(),
  aisleOrder: z.number().int().min(0).max(100_000).nullish(),
  imageUrl: z.string().url().max(400).nullish(),
  comparisonCents: z.number().int().min(0).max(10_000_000).nullish(),
  comparisonUnit: z.string().trim().max(8).nullish(),
  discountPercent: z.number().int().min(0).max(100).nullish(),
  discountType: z.string().trim().max(24).nullish(),
  offerAmount: z.number().int().min(1).max(99).nullish(),
  offerBundleCents: z.number().int().min(0).max(10_000_000).nullish(),
});

/**
 * An item is either a catalogue product or free text, never both and never
 * neither — enforced here so the rest of the code can rely on it.
 */
export const createItemSchema = itemContentSchema
  .extend({
    id: uuid.optional(),
    qty: qty.default(1),
    qtyUnit: qtyUnitSchema.default("kpl"),
    note: z.string().trim().max(200).nullish(),
    sortKey: sortKeySchema.nullish(),
    addedBy: uuid.nullish(),
  })
  .refine((v) => Boolean(v.ean) !== Boolean(v.freeText), {
    message: "Rivillä pitää olla joko tuote tai vapaa teksti",
    path: ["freeText"],
  });

export const updateItemSchema = z
  .object({
    qty: qty.optional(),
    qtyUnit: qtyUnitSchema.optional(),
    note: z.string().trim().max(200).nullish(),
    checked: z.boolean().optional(),
    sortKey: sortKeySchema.optional(),
    /** Client's clock for last-write-wins; the server clamps it. */
    updatedAt: z.coerce.date().optional(),
    updatedBy: uuid.nullish(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Ei muutettavia kenttiä" });

/**
 * A batch of offline changes flushed when connectivity returns.
 *
 * An entry is an *edit* or a *creation*, distinguished by whether it carries
 * content. An edit for a row the server has never seen is dropped — it belongs
 * to a different list, or to one already removed. A creation carries `ean` or
 * `freeText`, so the server can insert the row the device made while offline.
 */
export const syncSchema = z.object({
  memberId: uuid.nullish(),
  items: z
    .array(
      // Content fields are present only on rows created offline.
      itemContentSchema.extend({
        id: uuid,
        qty: qty.optional(),
        qtyUnit: qtyUnitSchema.optional(),
        note: z.string().trim().max(200).nullish(),
        checked: z.boolean().optional(),
        sortKey: sortKeySchema.optional(),
        deletedAt: z.coerce.date().nullish(),
        updatedAt: z.coerce.date(),
        updatedBy: uuid.nullish(),
      }),
    )
    .max(500, "Liian monta muutosta kerralla"),
});

export type CreateListInput = z.infer<typeof createListSchema>;
export type ItemContent = z.infer<typeof itemContentSchema>;
export type CreateItemInput = z.infer<typeof createItemSchema>;
export type UpdateItemInput = z.infer<typeof updateItemSchema>;
export type SyncInput = z.infer<typeof syncSchema>;
