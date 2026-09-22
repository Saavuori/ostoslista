import { expect, test } from "@playwright/test";

/**
 * The journeys that matter.
 *
 * These are deliberately end-to-end rather than component tests: the thing
 * that has to keep working is "make a list, send the link, both of us edit it",
 * and that spans the browser, the API and the database.
 */

async function createList(page: import("@playwright/test").Page, name: string) {
  await page.goto("/");
  await page.getByLabel("Listan nimi").fill(name);
  await page.getByRole("button", { name: "Tee lista" }).click();
  await page.waitForURL(/\/l\/[0-9A-Z]{16,32}$/);
  return page.url();
}

test.describe("making a list", () => {
  test("creates a list and lands on it", async ({ page }) => {
    await createList(page, "Viikon ostokset");

    await expect(page.getByRole("heading", { name: "Viikon ostokset" })).toBeVisible();
    await expect(page.getByText("Tyhjä lista")).toBeVisible();
    await expect(page.getByText("Aloita listan täyttäminen")).toBeVisible();
  });

  test("falls back to a dated name when none is given", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Tee lista" }).click();
    await page.waitForURL(/\/l\//);

    await expect(page.getByRole("heading", { name: /Ostokset \d+\.\d+/ })).toBeVisible();
  });
});

test.describe("my lists", () => {
  test("shows lists opened on this device and removes one from it", async ({ page }) => {
    const url = await createList(page, "Mökkireissu");

    await page.getByRole("link", { name: "‹ Omat listat" }).click();
    await page.waitForURL(/\/$/);

    const saved = page.getByRole("region", { name: "Omat listat" });
    await expect(saved.getByRole("link", { name: /Mökkireissu/ })).toBeVisible();

    await saved.getByRole("button", { name: "Poista Mökkireissu" }).click();
    await saved.getByRole("button", { name: "Poista", exact: true }).click();
    await expect(saved.getByRole("link", { name: /Mökkireissu/ })).toHaveCount(0);

    // Only forgotten locally: the link still works and brings it back.
    await page.goto(url);
    await expect(page.getByRole("heading", { name: "Mökkireissu" })).toBeVisible();
  });
});

test.describe("items", () => {
  test("adds a free-text item and keeps focus for the next one", async ({ page }) => {
    await createList(page, "Kauppa");

    const input = page.getByLabel("Lisää tuote");
    await input.fill("Maitoa");
    await input.press("Enter");

    await expect(page.getByText("Maitoa")).toBeVisible();
    await expect(page.getByText("1 jäljellä · 0 valmiina")).toBeVisible();

    // The field must stay focused and empty, so several items can be typed
    // in a row without re-tapping it.
    await expect(input).toBeFocused();
    await expect(input).toHaveValue("");

    await input.fill("Leipää");
    await input.press("Enter");
    await expect(page.getByText("2 jäljellä · 0 valmiina")).toBeVisible();
  });

  test("checks an item off, striking it through and moving it to the basket", async ({ page }) => {
    await createList(page, "Kauppa");

    const input = page.getByLabel("Lisää tuote");
    await input.fill("Maitoa");
    await input.press("Enter");
    await expect(page.getByText("Maitoa")).toBeVisible();

    await page
      .getByRole("button", { name: /Maitoa/ })
      .first()
      .click();

    await expect(page.getByText("Korissa · 1")).toBeVisible();
    await expect(page.getByText("Kaikki kerätty")).toBeVisible();
    // The strike-through is driven by this attribute.
    await expect(page.locator('.strike[data-checked="true"]')).toBeVisible();
  });

  test("unchecks an item again", async ({ page }) => {
    await createList(page, "Kauppa");
    const input = page.getByLabel("Lisää tuote");
    await input.fill("Maitoa");
    await input.press("Enter");

    const row = page.getByRole("button", { name: /Maitoa/ }).first();
    await row.click();
    await expect(page.getByText("Korissa · 1")).toBeVisible();

    await row.click();
    await expect(page.getByText("Korissa · 1")).toBeHidden();
    await expect(page.getByText("1 jäljellä · 0 valmiina")).toBeVisible();
  });

  test("removes an item", async ({ page }) => {
    await createList(page, "Kauppa");
    const input = page.getByLabel("Lisää tuote");
    await input.fill("Maitoa");
    await input.press("Enter");
    await expect(page.getByText("Maitoa")).toBeVisible();

    await page.getByRole("button", { name: "Poista Maitoa" }).click();

    await expect(page.getByText("Aloita listan täyttäminen")).toBeVisible();
  });

  test("bumps the quantity instead of adding a duplicate row", async ({ page }) => {
    await createList(page, "Kauppa");
    const input = page.getByLabel("Lisää tuote");

    await input.fill("Maitoa");
    await input.press("Enter");
    await expect(page.getByText("Maitoa")).toBeVisible();

    await input.fill("maitoa");
    await input.press("Enter");

    // Assert the durable outcome rather than the confirmation toast, which
    // clears itself after a couple of seconds and would make this flaky.
    await expect(page.getByText("1 jäljellä · 0 valmiina")).toBeVisible();

    // Counted as list rows: each row has both a toggle button and a remove
    // button whose names contain the item, so a button locator counts two.
    await expect(page.getByRole("listitem").filter({ hasText: "Maitoa" })).toHaveCount(1);
    await expect(page.getByRole("listitem").filter({ hasText: "Maitoa" })).toContainText("2 kpl");
  });
});

test.describe("sharing", () => {
  // The core promise of the product: send a link, edit it together, no account.
  test("a second person opens the link and sees the same list", async ({ page, browser }) => {
    const url = await createList(page, "Yhteinen lista");

    const input = page.getByLabel("Lisää tuote");
    await input.fill("Maitoa");
    await input.press("Enter");
    await expect(page.getByText("Maitoa")).toBeVisible();

    // A completely separate browser context: no cookies, no storage, no account.
    const otherContext = await browser.newContext();
    const otherPage = await otherContext.newPage();
    await otherPage.goto(url);

    await expect(otherPage.getByRole("heading", { name: "Yhteinen lista" })).toBeVisible();
    await expect(otherPage.getByText("Maitoa")).toBeVisible();

    // And they can edit without signing in.
    await otherPage.getByLabel("Lisää tuote").fill("Leipää");
    await otherPage.getByLabel("Lisää tuote").press("Enter");
    await expect(otherPage.getByText("Leipää")).toBeVisible();

    await page.reload();
    await expect(page.getByText("Leipää")).toBeVisible();

    await otherContext.close();
  });

  /**
   * The phase 3 promise: two people, one list, no refresh button.
   *
   * Deliberately asserts without any reload — that is the whole feature, and
   * a reload would hide a completely broken stream.
   */
  test("changes appear live for the other person without a reload", async ({ page, browser }) => {
    const url = await createList(page, "Yhteinen lista");

    const otherContext = await browser.newContext();
    const otherPage = await otherContext.newPage();
    await otherPage.goto(url);
    await expect(otherPage.getByText("Tyhjä lista")).toBeVisible();

    // Both are now connected, so each should see the other as a viewer.
    await expect(page.locator("header").getByText("2")).toBeVisible({ timeout: 15_000 });

    await page.getByLabel("Lisää tuote").fill("Maitoa");
    await page.getByLabel("Lisää tuote").press("Enter");

    // No reload anywhere in this assertion.
    await expect(otherPage.getByText("Maitoa")).toBeVisible({ timeout: 15_000 });
    await expect(otherPage.getByText("1 jäljellä · 0 valmiina")).toBeVisible();

    // And checking off propagates back the other way.
    await otherPage
      .getByRole("button", { name: /Maitoa/ })
      .first()
      .click();
    await expect(page.getByText("Korissa · 1")).toBeVisible({ timeout: 15_000 });

    // Removal too.
    await otherPage.getByRole("button", { name: "Poista Maitoa" }).click();
    await expect(page.getByText("Aloita listan täyttäminen")).toBeVisible({ timeout: 15_000 });

    await otherContext.close();
  });

  test("an unknown link shows a useful dead end, not a crash", async ({ page }) => {
    await page.goto("/l/ZZZZZZZZZZZZZZZZZZZZZZ");

    await expect(page.getByRole("heading", { name: "Listaa ei löytynyt" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Tee oma lista" })).toBeVisible();
  });
});

test.describe("product search", () => {
  /**
   * Search depends on an upstream that may be blocked, so this asserts the
   * contract rather than any particular result: whatever happens, typing a
   * name and pressing enter must still add the item.
   */
  test("degrades to free text when the catalogue is unavailable", async ({ page }) => {
    await createList(page, "Kauppa");

    const input = page.getByLabel("Lisää tuote");
    await input.fill("maito");
    // Past the debounce and the request.
    await page.waitForTimeout(1500);

    await input.press("Enter");
    await expect(page.getByText("maito", { exact: false }).first()).toBeVisible();
    await expect(page.getByText("1 jäljellä · 0 valmiina")).toBeVisible();
  });
});

test.describe("offline", () => {
  /**
   * The phase 4 promise, and the scenario the whole app is shaped around:
   * you are in a shop, the signal dies, and ticking things off keeps working.
   */
  test("keeps working with no connection and syncs when it returns", async ({ page, context }) => {
    await createList(page, "Kauppareissu");

    const input = page.getByLabel("Lisää tuote");
    await input.fill("Maitoa");
    await input.press("Enter");
    await input.fill("Leipää");
    await input.press("Enter");
    await expect(page.getByText("2 jäljellä · 0 valmiina")).toBeVisible();

    // The signal dies.
    await context.setOffline(true);

    // Ticking off still has to work, immediately and without complaint.
    await page
      .getByRole("button", { name: /Maitoa/ })
      .first()
      .click();
    await expect(page.getByText("Korissa · 1")).toBeVisible();

    // And so does adding.
    await input.fill("Voita");
    await input.press("Enter");
    await expect(page.getByText("Voita")).toBeVisible();

    // The header should say the work is safe, not that something failed.
    await expect(page.getByText("odottaa", { exact: false })).toBeVisible({ timeout: 10_000 });

    // Signal returns.
    await context.setOffline(false);

    // The queue drains on its own; no user action required.
    await expect(page.getByText("odottaa", { exact: false })).toBeHidden({ timeout: 30_000 });

    // The real proof: a fresh load from the server has all of it.
    await page.reload();
    await expect(page.getByText("Voita")).toBeVisible();
    await expect(page.getByText("Korissa · 1")).toBeVisible();
    await expect(page.getByText("2 jäljellä · 1 valmiina")).toBeVisible();
  });

  test("does not lose a removal made offline", async ({ page, context }) => {
    await createList(page, "Kauppareissu");

    const input = page.getByLabel("Lisää tuote");
    await input.fill("Maitoa");
    await input.press("Enter");
    await expect(page.getByText("Maitoa")).toBeVisible();

    await context.setOffline(true);
    await page.getByRole("button", { name: "Poista Maitoa" }).click();
    await expect(page.getByText("Aloita listan täyttäminen")).toBeVisible();

    // Assert it was actually queued first: otherwise the drain check below
    // would pass simply because nothing was ever pending.
    await expect(page.getByText("odottaa", { exact: false })).toBeVisible({ timeout: 10_000 });

    await context.setOffline(false);
    await expect(page.getByText("odottaa", { exact: false })).toBeHidden({ timeout: 30_000 });

    await page.reload();
    // It must stay deleted rather than reappearing on the next sync.
    await expect(page.getByText("Aloita listan täyttäminen")).toBeVisible();
  });
});

test.describe("history", () => {
  // Households buy the same things over and over; re-tapping last week's list
  // is the fastest way to build this week's.
  test("offers something removed earlier and re-adds it in one tap", async ({ page }) => {
    await createList(page, "Kauppa");

    const input = page.getByLabel("Lisää tuote");
    await input.fill("Kahvia");
    await input.press("Enter");
    await expect(page.getByText("Kahvia")).toBeVisible();

    await page.getByRole("button", { name: "Poista Kahvia" }).click();
    await expect(page.getByText("Aloita listan täyttäminen")).toBeVisible();

    const chip = page.getByRole("button", { name: "Kahvia", exact: true });
    await expect(chip).toBeVisible({ timeout: 10_000 });

    await chip.click();

    await expect(page.getByText("1 jäljellä · 0 valmiina")).toBeVisible();
    // Once it is back on the list, offering it again is noise.
    await expect(chip).toBeHidden({ timeout: 10_000 });
  });
});

test.describe("accessibility and layout", () => {
  test("the add control stays reachable in the thumb zone", async ({ page }) => {
    await createList(page, "Kauppa");

    const button = page.getByRole("button", { name: "Lisää", exact: true });
    const box = await button.boundingBox();
    const viewport = page.viewportSize();

    expect(box).not.toBeNull();
    expect(viewport).not.toBeNull();
    // Bottom half of the screen, and a real tap target.
    expect(box!.y).toBeGreaterThan(viewport!.height / 2);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });

  test("rows are keyboard reachable and expose their checked state", async ({ page }) => {
    await createList(page, "Kauppa");
    const input = page.getByLabel("Lisää tuote");
    await input.fill("Maitoa");
    await input.press("Enter");

    const row = page.getByRole("button", { name: /Maitoa/ }).first();
    await expect(row).toHaveAttribute("aria-pressed", "false");

    await row.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText("Korissa · 1")).toBeVisible();
  });
});
