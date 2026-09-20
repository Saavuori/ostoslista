// jest-dom matchers are only meaningful in a DOM environment; component tests
// opt into jsdom with a `@vitest-environment jsdom` docblock.
if (typeof window !== "undefined") {
  await import("@testing-library/jest-dom/vitest");
}

export {};
