import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb, type TestDb } from "../helpers/db";

/**
 * The stream endpoint is not wrapped in `handle()`, because it returns a raw
 * streaming Response. Its authorisation failures still have to come back as
 * the statuses the rest of the API uses, not as an unhandled 500.
 */
let testDb: TestDb;
let close: () => Promise<void>;

vi.mock("@/lib/db", () => ({
  get db() {
    return testDb;
  },
}));

const { GET } = await import("@/app/api/lists/[token]/events/route");

beforeAll(async () => {
  const created = await createTestDb();
  testDb = created.db;
  close = created.close;
});

afterAll(async () => {
  await close();
});

const open = (token: string) =>
  GET(new Request(`http://localhost/api/lists/${token}/events`), {
    params: Promise.resolve({ token }),
  });

describe("GET /api/lists/[token]/events", () => {
  it("answers a malformed token with 404", async () => {
    expect((await open("nope")).status).toBe(404);
  });

  it("answers an unknown token with 404", async () => {
    expect((await open("ZZZZZZZZZZZZZZZZZZZZZZ")).status).toBe(404);
  });
});
