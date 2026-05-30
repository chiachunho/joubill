/**
 * Loads a Huninn (粉圓體) font subset from Google Fonts at runtime.
 *
 * Huninn covers Traditional Chinese + Latin + digits in a single rounded face,
 * matching the app's rounded design language. We request only the glyphs that
 * actually appear on the card (`&text=`), so each fetch returns a tiny subset
 * instead of the multi-MB full CJK font.
 *
 * satori needs ttf/otf/woff (not woff2); Google serves truetype when the
 * request carries no modern browser User-Agent, which is the default for the
 * Node fetch here.
 */
const cache = new Map<string, ArrayBuffer>();

/** Deduplicate + sort characters so equivalent text reuses one cache entry. */
function glyphKey(text: string): string {
  return Array.from(new Set(Array.from(text))).sort().join("");
}

export async function loadHuninn(text: string): Promise<ArrayBuffer> {
  const key = glyphKey(text);
  const cached = cache.get(key);
  if (cached) return cached;

  const url =
    `https://fonts.googleapis.com/css2?family=Huninn&text=${encodeURIComponent(key)}`;
  const cssRes = await fetch(url);
  if (!cssRes.ok) throw new Error(`google fonts css ${cssRes.status}`);
  const css = await cssRes.text();

  const match = css.match(/src:\s*url\(([^)]+)\)\s*format\('(?:opentype|truetype)'\)/);
  if (!match) throw new Error("no truetype src in google fonts css");

  const fontRes = await fetch(match[1]);
  if (!fontRes.ok) throw new Error(`google fonts file ${fontRes.status}`);
  const data = await fontRes.arrayBuffer();

  cache.set(key, data);
  return data;
}
