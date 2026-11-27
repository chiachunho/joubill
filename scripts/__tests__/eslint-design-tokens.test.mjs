import { Linter } from "eslint";
import { describe, expect, it } from "vitest";

import plugin, { checkClasses, loadTheme, themeKeys, utilityOf } from "../eslint-design-tokens.mjs";

const CSS = `
@import "tailwindcss";
@theme inline {
  --radius-*: initial;
  --radius-lg: var(--radius);
  --radius-2xl: calc(var(--radius) + 6px);
  --color-*: initial;
  --color-rose-500: #f43f5e;
  --color-primary: hsl(var(--primary));
}
:root {
  --color-blue-500: #00f; /* outside @theme: not a token */
}
`;
const theme = loadTheme(CSS);

describe("themeKeys", () => {
  it("reads only the keys declared inside @theme, skipping the initial reset", () => {
    expect([...themeKeys(CSS, "radius")]).toEqual(["lg", "2xl"]);
    expect([...themeKeys(CSS, "color")]).toEqual(["rose-500", "primary"]);
  });

  it("finds the project's own tokens in src/app/globals.css", () => {
    const real = loadTheme();
    expect(real.radius).toContain("lg");
    expect(real.radius).toContain("2xl");
    expect(real.radius).not.toContain("xl");
    expect(real.color).toContain("emerald-500");
    expect(real.color).not.toContain("blue-500");
  });
});

describe("utilityOf", () => {
  it("strips variants, important and a negative sign", () => {
    expect(utilityOf("md:hover:rounded-xl")).toBe("rounded-xl");
    expect(utilityOf("!text-[13px]")).toBe("text-[13px]");
    expect(utilityOf("bg-[#fff]!")).toBe("bg-[#fff]");
    expect(utilityOf("-mt-2")).toBe("mt-2");
  });

  it("keeps a colon that sits inside an arbitrary value", () => {
    expect(utilityOf("[&:hover]:rounded-[9px]")).toBe("rounded-[9px]");
    expect(utilityOf("text-[length:13px]")).toBe("text-[length:13px]");
  });
});

describe("checkClasses", () => {
  it("accepts the documented tokens", () => {
    expect(
      checkClasses(
        "rounded-2xl rounded-lg rounded-full rounded-none rounded-t-lg text-2xs text-rose-500 " +
          "bg-primary/10 text-[hsl(var(--brand-gold))] h-[66px] size-[14px] max-h-(--radix-x)",
        theme,
      ),
    ).toEqual([]);
  });

  it("reports a radius the theme does not have, bare `rounded` included", () => {
    expect(checkClasses("rounded-xl", theme)).toHaveLength(1);
    expect(checkClasses("rounded", theme)).toHaveLength(1);
    expect(checkClasses("sm:rounded-bl-3xl", theme)).toHaveLength(1);
  });

  it("reports arbitrary radii and font sizes", () => {
    expect(checkClasses("rounded-[9px]", theme)[0]).toMatch(/rounded-2xl/);
    expect(checkClasses("text-[13px] text-[0.8rem] text-[length:12px]", theme)).toHaveLength(3);
  });

  it("reports literal colours but not a CSS variable", () => {
    expect(
      checkClasses("bg-[#10b981] text-[rgb(0,0,0)] border-t-[hsl(0_0%_0%)]", theme),
    ).toHaveLength(3);
    expect(checkClasses("text-[hsl(var(--brand-gold))]", theme)).toEqual([]);
  });

  it("reports a named colour outside the theme", () => {
    expect(checkClasses("text-rose-500 text-rose-600 bg-blue-500/20", theme)).toEqual([
      "text-rose-600: rose-600 is not one of the theme's colours",
      "bg-blue-500/20: blue-500 is not one of the theme's colours",
    ]);
  });
});

describe("design/tokens rule", () => {
  const lint = (code) =>
    new Linter({ configType: "flat" }).verify(code, {
      languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
      plugins: { design: plugin },
      rules: { "design/tokens": "error" },
    });

  it("checks className, classNames, class helpers and *class* variables", () => {
    const messages = lint(`
      const a = <div className="rounded-xl" />;
      const b = <Cal classNames={{ head: "text-[13px]" }} />;
      const c = cn("p-2", ok && \`rounded-[3px]\`);
      const SIZE_CLASS = { xs: "bg-[#fff]" };
    `);
    expect(messages.map((m) => m.line)).toEqual([2, 3, 4, 5]);
  });

  it("leaves strings that are not class lists alone", () => {
    expect(lint(`const msg = "rounded to the cent"; label("rounded-xl");`)).toEqual([]);
  });
});
