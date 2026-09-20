/**
 * Id and token generation.
 *
 * Ids are generated on whichever device creates the row, never by the server:
 * adding an item while offline must not require a round-trip.
 */

/**
 * UUIDv7 — 48 bits of Unix milliseconds, then randomness.
 *
 * Chosen over v4 because it sorts by creation time, so list items arrive in
 * insertion order without a separate sequence, and Postgres index locality
 * stays good as the table grows.
 *
 * Layout (RFC 9562):
 *   0-5   timestamp, big-endian milliseconds
 *   6     version (7) in the high nibble, random low nibble
 *   7     random
 *   8     variant (0b10) in the high bits, random low bits
 *   9-15  random
 */
export function uuidv7(now: number = Date.now()): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);

  // Big-endian 48-bit timestamp. Number is safe: 2^48 ms is year 10889.
  const ts = BigInt(now);
  bytes[0] = Number((ts >> 40n) & 0xffn);
  bytes[1] = Number((ts >> 32n) & 0xffn);
  bytes[2] = Number((ts >> 24n) & 0xffn);
  bytes[3] = Number((ts >> 16n) & 0xffn);
  bytes[4] = Number((ts >> 8n) & 0xffn);
  bytes[5] = Number(ts & 0xffn);

  // Version 7 and the RFC 4122 variant.
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Extracts the embedded millisecond timestamp from a UUIDv7. */
export function uuidv7Time(id: string): number {
  return Number.parseInt(id.replace(/-/g, "").slice(0, 12), 16);
}

/**
 * Share-link alphabet.
 *
 * Crockford-ish: no I, L, O, U, so a token read aloud or retyped from a
 * screenshot does not turn into a different list.
 */
const TOKEN_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * A share token.
 *
 * 22 characters of this alphabet is ~110 bits — the token is the only thing
 * protecting a list, so it has to be unguessable rather than merely unique.
 * Rejection sampling keeps the distribution uniform.
 */
export function generateShareToken(length = 22): string {
  const max = 256 - (256 % TOKEN_ALPHABET.length);
  let out = "";
  const buf = new Uint8Array(length * 2);
  while (out.length < length) {
    crypto.getRandomValues(buf);
    for (const byte of buf) {
      if (out.length === length) break;
      if (byte < max) out += TOKEN_ALPHABET[byte % TOKEN_ALPHABET.length];
    }
  }
  return out;
}

const TOKEN_PATTERN = new RegExp(`^[${TOKEN_ALPHABET}]{16,32}$`);

export function isValidShareToken(token: string): boolean {
  return TOKEN_PATTERN.test(token);
}

/**
 * Normalises a token the way a human might have mangled it: lowercase, and the
 * letters the alphabet deliberately omits mapped back to the digits they are
 * usually mistaken for.
 */
export function normalizeShareToken(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[IL]/g, "1")
    .replace(/O/g, "0")
    .replace(/U/g, "V")
    .replace(/[^0-9A-Z]/g, "");
}
