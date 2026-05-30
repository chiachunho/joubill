import type { ReactNode } from "react";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";

import { loadHuninn } from "./font";

/**
 * Render a satori element tree to a PNG buffer, subsetting the Huninn font to
 * exactly the glyphs in `glyphText`. satori converts text to vector paths using
 * the supplied font, so resvg needs no system fonts of its own.
 */
export async function renderToPng(
  element: ReactNode,
  glyphText: string,
  width: number,
): Promise<Buffer> {
  const font = await loadHuninn(glyphText);

  const svg = await satori(element, {
    width,
    fonts: [{ name: "Huninn", data: font, weight: 400, style: "normal" }],
  });

  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: width },
    font: { loadSystemFonts: false },
  });
  return Buffer.from(resvg.render().asPng());
}
