/**
 * The client build number K-Ruoka's API requires.
 *
 * Every API response carries the current value in a `k-ruoka-build` header,
 * so it is learned from the API itself and remembered here. A stale value is
 * currently accepted; if the API starts refusing one, it answers
 *
 *   409 {"error":{"message":"Client version is too old - reload"}}
 *
 * with the current value in that same header, and the client retries once.
 *
 * The header must be present at all: requests without it are answered with a
 * Cloudflare challenge. The storefront HTML — where this used to be scraped
 * from `/assets/b-<number>/` — is challenged for every scripted client, so it
 * cannot be the source any more.
 */

/** Sent until a response has told us the real value. Any number is accepted. */
export const BOOTSTRAP_BUILD_NUMBER = "0";

const HEADER = "k-ruoka-build";
const VALID = /^\d{1,10}$/;

let current: string | null = null;

/** The value to send: the last one the API reported, or the bootstrap. */
export function getBuildNumber(): string {
  return current ?? BOOTSTRAP_BUILD_NUMBER;
}

/**
 * Records the build number from a response's headers, if it carries one.
 * Returns true when a usable value was found.
 */
export function rememberBuildNumber(headers: Record<string, string> | undefined): boolean {
  const value = headers?.[HEADER]?.trim();
  if (!value || !VALID.test(value)) return false;
  current = value;
  return true;
}

/** Forgets the remembered value. Called when the API reports it is stale. */
export function invalidateBuildNumber(): void {
  current = null;
}
