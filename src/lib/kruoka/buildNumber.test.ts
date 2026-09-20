import { beforeEach, describe, expect, it } from "vitest";
import { extractBuildNumber, getBuildNumber, invalidateBuildNumber } from "./buildNumber";

beforeEach(() => {
  invalidateBuildNumber();
});

describe("extractBuildNumber", () => {
  // The API rejects requests without it: 409 "Client version is too old".
  it("reads the build number from an asset path", () => {
    expect(extractBuildNumber('<script src="/assets/b-32654/bundle.js"></script>')).toBe("32654");
  });

  it("returns null when the markup has no asset path", () => {
    expect(extractBuildNumber("<html><body>hei</body></html>")).toBeNull();
  });
});

describe("getBuildNumber", () => {
  const page = (build: string) => ({
    status: 200,
    body: `<script src="/assets/b-${build}/bundle.js"></script>`,
  });

  it("fetches and returns the current build", async () => {
    expect(await getBuildNumber(async () => page("32654"))).toBe("32654");
  });

  it("caches, so every search does not refetch a three-megabyte page", async () => {
    let calls = 0;
    const fetcher = async () => {
      calls += 1;
      return page("32654");
    };

    await getBuildNumber(fetcher);
    await getBuildNumber(fetcher);

    expect(calls).toBe(1);
  });

  // On a cold start several searches arrive at once; they should share one
  // request rather than each fetching the storefront.
  it("shares one in-flight request between concurrent callers", async () => {
    let calls = 0;
    const fetcher = async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 20));
      return page("32654");
    };

    await Promise.all([getBuildNumber(fetcher), getBuildNumber(fetcher), getBuildNumber(fetcher)]);

    expect(calls).toBe(1);
  });

  it("re-reads after being invalidated by a stale-version response", async () => {
    let build = "32654";
    const fetcher = async () => page(build);

    expect(await getBuildNumber(fetcher)).toBe("32654");
    build = "32700";
    invalidateBuildNumber();
    expect(await getBuildNumber(fetcher)).toBe("32700");
  });

  it("throws when the storefront cannot be read", async () => {
    await expect(getBuildNumber(async () => ({ status: 403, body: "" }))).rejects.toThrow(/403/);
  });

  it("throws when the markup carries no build number", async () => {
    await expect(
      getBuildNumber(async () => ({ status: 200, body: "<html></html>" })),
    ).rejects.toThrow(/no build number/);
  });

  it("does not cache a failure", async () => {
    let fail = true;
    const fetcher = async () => (fail ? { status: 500, body: "" } : page("32654"));

    await expect(getBuildNumber(fetcher)).rejects.toThrow();
    fail = false;
    expect(await getBuildNumber(fetcher)).toBe("32654");
  });
});
