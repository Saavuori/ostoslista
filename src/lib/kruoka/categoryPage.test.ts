import { describe, expect, it } from "vitest";
import { eanFromHref, parseCardPrice, parseCategoryCards, type RawCard } from "./categoryPage";

describe("eanFromHref", () => {
  it("reads the ean and slug from a product link", () => {
    expect(eanFromHref("/kauppa/tuote/pirkka-kevytmaito-1-l-6410405082657")).toEqual({
      ean: "6410405082657",
      slug: "pirkka-kevytmaito-1-l-6410405082657",
    });
  });

  it("drops a store suffix so local items key like national ones", () => {
    expect(eanFromHref("/kauppa/tuote/kirjolohifilee-kg-2000456700002-n106")?.ean).toBe(
      "2000456700002",
    );
  });

  it("returns null for anything that is not a product link", () => {
    expect(eanFromHref("/kauppa/tuotehaku/juomat")).toBeNull();
    expect(eanFromHref("/kauppa/tuote/ei-numeroita")).toBeNull();
  });
});

describe("parseCardPrice", () => {
  it("reads a plain piece price", () => {
    expect(parseCardPrice("Pirkka maito Hinta 0,99 € kappale 0 99 /kpl")).toEqual({
      cents: 99,
      unit: "kpl",
    });
  });

  it("reads a price per kilo", () => {
    expect(parseCardPrice("Lohifilee Hinta 39,99 € kilogramma")).toEqual({
      cents: 3999,
      unit: "kg",
    });
  });

  it("reads a price per litre", () => {
    expect(parseCardPrice("Mehu Hinta 2,50 € litra")).toEqual({ cents: 250, unit: "l" });
  });

  it("handles an approximate price for goods weighed at the till", () => {
    expect(parseCardPrice("Kirjolohi Hinta noin 22,49 € kappale")?.cents).toBe(2249);
  });

  /**
   * Loyalty-card cards show the offer price prominently and the shelf price as
   * "Ilman Plussa-korttia". The shelf price is the honest one for a total:
   * quoting the card price to someone without the card understates the bill.
   */
  it("prefers the shelf price over a loyalty-card offer", () => {
    const card =
      "Kokkikartano kirjolohikiusaus Plussa-etu −10 % Etuhinta Plussa-kortilla 5,89 € kappale " +
      "Ilman Plussa-korttia 6,59 € kappale (9,41 € kilogramma)";

    expect(parseCardPrice(card)).toEqual({ cents: 659, unit: "kpl" });
  });

  it("returns null when there is no price on the card", () => {
    expect(parseCardPrice("Pirkka maito")).toBeNull();
    expect(parseCardPrice("")).toBeNull();
  });
});

describe("parseCategoryCards", () => {
  const card = (href: string, name: string, cardText: string): RawCard => ({
    href,
    name,
    cardText,
  });

  it("builds products with their aisle attached", () => {
    const items = parseCategoryCards(
      [
        card(
          "/kauppa/tuote/pirkka-kevytmaito-1-l-6410405082657",
          "Pirkka suomalainen kevytmaito 1l",
          "Pirkka suomalainen kevytmaito 1l Hinta 0,99 € kappale",
        ),
      ],
      "maito-juusto-munat-ja-rasvat",
      "Maito, juusto ja munat",
    );

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      ean: "6410405082657",
      name: "Pirkka suomalainen kevytmaito 1l",
      priceCents: 99,
      unit: "kpl",
      categoryName: "Maito, juusto ja munat",
    });
    expect(items[0]?.categoryOrder).toBeGreaterThan(0);
  });

  it("drops cards with no readable price rather than guessing", () => {
    const items = parseCategoryCards(
      [card("/kauppa/tuote/maito-6410405082657", "Maito", "Maito")],
      "maito-juusto-munat-ja-rasvat",
      "Maito",
    );
    expect(items).toEqual([]);
  });

  it("de-duplicates a product listed more than once on a page", () => {
    const one = card("/kauppa/tuote/maito-6410405082657", "Maito", "Maito Hinta 0,99 € kappale");
    expect(parseCategoryCards([one, one], "maito-juusto-munat-ja-rasvat", "Maito")).toHaveLength(1);
  });

  it("orders aisles so produce comes before household goods", () => {
    const make = (slug: string) =>
      parseCategoryCards(
        [card("/kauppa/tuote/x-1234567890123", "X", "X Hinta 1,00 € kappale")],
        slug,
        slug,
      )[0]?.categoryOrder ?? 0;

    expect(make("hedelmat-ja-vihannekset")).toBeLessThan(make("kodinhoito-ja-taloustarvikkeet"));
  });
});
