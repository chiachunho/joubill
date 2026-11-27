/**
 * ESLint rule `design/tokens`: the class-name half of docs/design-system.md.
 *
 * The `@theme` block in src/app/globals.css already removes Tailwind's default radii and colours,
 * so `rounded-xl` or `bg-blue-500` generate no CSS. That shows on screen, not in review, and it
 * cannot see arbitrary values at all: `rounded-[9px]`, `text-[13px]` and `bg-[#10b981]` compile
 * whatever the theme says. This rule reports both kinds, reading the allowed radii and colours
 * from that same `@theme` block, so the two lists cannot disagree.
 *
 * Only strings in a class context are checked: an attribute whose name mentions "class"
 * (`className`, react-day-picker's `classNames`), an argument of
 * `cn` / `cva` / `clsx` / `twMerge`, or a variable or property whose name mentions "class".
 * Anything else ("rounded to the cent") is prose.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const GLOBALS_CSS = fileURLToPath(new URL("../src/app/globals.css", import.meta.url));

/** The `--<namespace>-<name>:` keys of every `@theme` block, e.g. `radius` → `["sm", "lg"]`. */
export function themeKeys(css, namespace) {
  const keys = new Set();
  for (const block of css.matchAll(/@theme[^{]*\{([\s\S]*?)\n\}/g)) {
    for (const m of block[1].matchAll(new RegExp(`--${namespace}-([a-z0-9-]+)\\s*:`, "g"))) {
      keys.add(m[1]);
    }
  }
  return keys;
}

/** What the theme allows, read once per lint run. */
export function loadTheme(css = readFileSync(GLOBALS_CSS, "utf8")) {
  return {
    // rounded-full and rounded-none are static utilities, not theme values.
    radius: new Set([...themeKeys(css, "radius"), "full", "none"]),
    color: themeKeys(css, "color"),
  };
}

const PALETTE =
  "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
const COLOR_UTILITY =
  "bg|text|border(?:-[xytrblse])?|divide|ring|ring-offset|outline|fill|stroke|from|via|to|decoration|accent|caret|placeholder|shadow|inset-shadow|inset-ring";
const RADIUS = /^rounded(?:-(?:t|r|b|l|s|e|tl|tr|br|bl|ss|se|es|ee))?(?:-(.+))?$/;
const NAMED_COLOR = new RegExp(`^(?:${COLOR_UTILITY})-((?:${PALETTE})-\\d{2,3})(?:/.+)?$`);
// A colour written out instead of a variable: `bg-[#fff]`, `text-[rgb(…)]`. `[hsl(var(--x))]`
// is the documented way to reach --brand-gold, so only literal colours are reported.
const ARBITRARY_COLOR = new RegExp(
  `^(?:${COLOR_UTILITY})-\\[(?:color:)?(?:#|rgba?\\(|hsla?\\(\\s*\\d|oklch\\(|oklab\\()`,
);
// `text-[13px]/5` carries a line height after the slash; it is still an arbitrary size.
const ARBITRARY_FONT_SIZE = /^text-\[(?:length:)?[\d.]+(?:px|rem|em)?\](?:\/.+)?$/;

/** The utility a class names, without its variants (`md:hover:`), `!` or a leading `-`. */
export function utilityOf(token) {
  let depth = 0;
  let start = 0;
  for (let i = 0; i < token.length; i++) {
    const c = token[i];
    if (c === "[" || c === "(") depth++;
    else if (c === "]" || c === ")") depth--;
    else if (c === ":" && depth === 0) start = i + 1;
  }
  return token.slice(start).replace(/^!|!$/g, "").replace(/^-/, "");
}

/** One message per offending class in `text`, in order. */
export function checkClasses(text, theme) {
  const problems = [];
  for (const token of text.split(/\s+/)) {
    if (!token) continue;
    const utility = utilityOf(token);
    const radius = utility.match(RADIUS);
    if (radius) {
      const size = radius[1];
      if (size?.startsWith("[")) {
        problems.push(`${token}: radius is rounded-2xl (container) or rounded-lg (control)`);
      } else if (size === undefined || !theme.radius.has(size)) {
        problems.push(`${token}: not a radius in the theme (${[...theme.radius].join(", ")})`);
      }
      continue;
    }
    if (ARBITRARY_FONT_SIZE.test(utility)) {
      problems.push(`${token}: use a Tailwind text size or text-2xs, never text-[…]`);
      continue;
    }
    if (ARBITRARY_COLOR.test(utility)) {
      problems.push(`${token}: colours go through the theme's CSS variables, not a literal`);
      continue;
    }
    const named = utility.match(NAMED_COLOR);
    if (named && !theme.color.has(named[1])) {
      problems.push(`${token}: ${named[1]} is not one of the theme's colours`);
    }
  }
  return problems;
}

const CLASS_CALLS = new Set(["cn", "cva", "clsx", "twMerge"]);
const CLASS_NAME = /class/i;

/** Whether a string node sits somewhere a class list is written. */
function inClassContext(node) {
  for (let n = node.parent; n; n = n.parent) {
    if (n.type === "JSXAttribute") return CLASS_NAME.test(n.name.name);
    if (n.type === "CallExpression" && n.callee.type === "Identifier") {
      if (CLASS_CALLS.has(n.callee.name)) return true;
    }
    if (n.type === "VariableDeclarator" && n.id.type === "Identifier") {
      return CLASS_NAME.test(n.id.name);
    }
    if (n.type === "Property" && n.key.type === "Identifier" && CLASS_NAME.test(n.key.name)) {
      return true;
    }
    if (
      n.type === "Program" ||
      n.type.startsWith("Function") ||
      n.type === "ArrowFunctionExpression"
    ) {
      return false;
    }
  }
  return false;
}

let cachedTheme;

export const tokensRule = {
  meta: {
    type: "problem",
    docs: { description: "Class names stay inside the design tokens (docs/design-system.md)" },
    schema: [],
  },
  create(context) {
    cachedTheme ??= loadTheme();
    const report = (node, text) => {
      if (!inClassContext(node)) return;
      for (const message of checkClasses(text, cachedTheme)) context.report({ node, message });
    };
    return {
      Literal(node) {
        if (typeof node.value === "string") report(node, node.value);
      },
      TemplateElement(node) {
        report(node, node.value.cooked ?? node.value.raw);
      },
    };
  },
};

const plugin = { rules: { tokens: tokensRule } };
export default plugin;
