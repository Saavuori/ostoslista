/**
 * Product image sizing.
 *
 * Kesko's CDN serves originals at around 1440x2288. Rendering one of those in
 * a 48px thumbnail downloads roughly a megabyte to show a postage stamp, which
 * is exactly the wrong trade for an app whose whole premise is working on a
 * bad connection in a shop.
 *
 * The CDN accepts a `w` query parameter and returns a correctly scaled image,
 * so ask for the size we are actually going to draw.
 */

const SUPPORTED_HOST = "public.keskofiles.com";

/**
 * Returns the image URL scaled for a given CSS width.
 *
 * Doubled for high-density screens, which nearly every phone has. Hosts we do
 * not recognise are returned untouched rather than given a parameter that
 * might mean something else.
 */
export function productImageUrl(url: string | null, cssWidth: number): string | null {
  if (!url) return null;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }

  if (parsed.hostname !== SUPPORTED_HOST) return url;

  parsed.searchParams.set("w", String(Math.round(cssWidth * 2)));
  return parsed.toString();
}
