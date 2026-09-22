import { describe, expect, it } from "vitest";
import { parseCurlOutput } from "./transport";

describe("parseCurlOutput", () => {
  it("splits body, headers and status", () => {
    const out =
      '{"ok":true}\n__HEADERS__{"k-ruoka-build":["32769"],"Vary":["a","b"]}\n__STATUS__200';

    expect(parseCurlOutput(out)).toEqual({
      body: '{"ok":true}',
      status: 200,
      headers: { "k-ruoka-build": "32769", vary: "a" },
    });
  });

  it("is not fooled by a body that contains the markers", () => {
    const body = "text\n__STATUS__999\n__HEADERS__{}";
    const out = `${body}\n__HEADERS__{}\n__STATUS__409`;

    expect(parseCurlOutput(out)).toEqual({ body, status: 409, headers: {} });
  });

  it("keeps body and status when the header block is unreadable", () => {
    expect(parseCurlOutput("body\n__HEADERS__not json\n__STATUS__200")).toEqual({
      body: "body",
      status: 200,
      headers: {},
    });
  });

  it("accepts output without a header block", () => {
    expect(parseCurlOutput("body\n__STATUS__204")).toEqual({ body: "body", status: 204 });
  });

  it("returns null without a status", () => {
    expect(parseCurlOutput("<html>")).toBeNull();
  });
});
