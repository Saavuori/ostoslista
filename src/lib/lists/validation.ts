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

export const qtyUnitSchema = z.enum(["kpl", "kg", "l"]);

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

export const updateListSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  storeId: z
    .string()
    .trim()
    .regex(/^[A-Z0-9]{2,16}$/)
    .optional(),
  archived: z.boolean().optional(),
});

/**
 * An item is either a catalogue product or free text, never both and never
 * neither — enforced here so the rest of the code can rely on it.
 */
export const createItemSchema = z
  .object({
    id: uuid.optional(),
    ean: z
      .string()
      .regex(/^\d{8,14}$/, "Virheellinen EAN-koodi")
      .nullish(),
    freeText: z.string().trim().min(1).max(200).nullish(),
    nameSnapshot: z.string().trim().min(1).max(200).nullish(),
    priceCentsSnapshot: z.number().int().min(0).max(10_000_000).nullish(),
    qty: qty.default(1),
    qtyUnit: qtyUnitSchema.default("kpl"),
    note: z.string().trim().max(200).nullish(),
    sortKey: z.number().finite().nullish(),
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
    sortKey: z.number().finite().optional(),
    /** Client's clock for last-write-wins; the server clamps it. */
    updatedAt: z.coerce.date().optional(),
    updatedBy: uuid.nullish(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Ei muutettavia kenttiä" });

/** A batch of offline edits flushed when connectivity returns. */
export const syncSchema = z.object({
  memberId: uuid.nullish(),
  items: z
    .array(
      z.object({
        id: uuid,
        qty: qty.optional(),
        qtyUnit: qtyUnitSchema.optional(),
        note: z.string().trim().max(200).nullish(),
        checked: z.boolean().optional(),
        sortKey: z.number().finite().optional(),
        deletedAt: z.coerce.date().nullish(),
        updatedAt: z.coerce.date(),
        updatedBy: uuid.nullish(),
      }),
    )
    .max(500, "Liian monta muutosta kerralla"),
});

export type CreateListInput = z.infer<typeof createListSchema>;
export type UpdateListInput = z.infer<typeof updateListSchema>;
export type CreateItemInput = z.infer<typeof createItemSchema>;
export type UpdateItemInput = z.infer<typeof updateItemSchema>;
export type SyncInput = z.infer<typeof syncSchema>;
