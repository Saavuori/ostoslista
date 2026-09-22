import { beforeEach, describe, expect, it } from "vitest";
import {
  BOOTSTRAP_BUILD_NUMBER,
  getBuildNumber,
  invalidateBuildNumber,
  rememberBuildNumber,
} from "./buildNumber";
import { KRuokaClient } from "./client";
import type { TransportRequest, TransportResponse } from "./transport";

beforeEach(() => {
  invalidateBuildNumber();
});

describe("build number", () => {
  // The header has to be sent at all, or Cloudflare challenges the request.
  it("starts from the bootstrap value", () => {
    expect(getBuildNumber()).toBe(BOOTSTRAP_BUILD_NUMBER);
  });

  it("remembers the value a response reports", () => {
    expect(rememberBuildNumber({ "k-ruoka-build": "32769" })).toBe(true);
    expect(getBuildNumber()).toBe("32769");
  });

  it("ignores responses without a usable header", () => {
    rememberBuildNumber({ "k-ruoka-build": "32769" });

    expect(rememberBuildNumber(undefined)).toBe(false);
    expect(rememberBuildNumber({})).toBe(false);
    expect(rememberBuildNumber({ "k-ruoka-build": "b-1; drop" })).toBe(false);
    expect(getBuildNumber()).toBe("32769");
  });

  it("goes back to the bootstrap once invalidated", () => {
    rememberBuildNumber({ "k-ruoka-build": "32769" });
    invalidateBuildNumber();
    expect(getBuildNumber()).toBe(BOOTSTRAP_BUILD_NUMBER);
  });
});

describe("KRuokaClient build handshake", () => {
  const ok = (build: string): TransportResponse => ({
    status: 200,
    body: JSON.stringify({ result: [] }),
    headers: { "k-ruoka-build": build },
  });
  const stale = (build: string | null): TransportResponse => ({
    status: 409,
    body: JSON.stringify({ error: { message: "Client version is too old - reload" } }),
    ...(build ? { headers: { "k-ruoka-build": build } } : {}),
  });

  function recordingClient(responses: TransportResponse[]) {
    const sent: string[] = [];
    const transport = async (_url: string, options?: TransportRequest) => {
      sent.push(options?.headers?.["X-K-Build-Number"] ?? "(none)");
      const next = responses.shift();
      if (!next) throw new Error("unexpected request");
      return next;
    };
    return { sent, client: new KRuokaClient({ transport, minIntervalMs: 0 }) };
  }

  it("learns the build from a successful response and sends it next time", async () => {
    const { sent, client } = recordingClient([ok("32769"), ok("32769")]);

    await client.searchProducts("maito");
    await client.searchProducts("leipä");

    expect(sent).toEqual([BOOTSTRAP_BUILD_NUMBER, "32769"]);
  });

  it("retries once with the build a 409 reports", async () => {
    const { sent, client } = recordingClient([stale("32800"), ok("32800")]);

    await client.searchProducts("maito");

    expect(sent).toEqual([BOOTSTRAP_BUILD_NUMBER, "32800"]);
  });

  it("does not loop when the API keeps refusing", async () => {
    const { sent, client } = recordingClient([stale(null), stale(null)]);

    await expect(client.searchProducts("maito")).rejects.toThrow(/409/);
    expect(sent).toHaveLength(2);
  });
});
