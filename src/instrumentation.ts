/**
 * Next.js startup hook (runs once per server instance).
 *
 * Silences the noisy `DEP0169` url.parse() deprecation warning emitted by
 * Next.js internals (next/dist/server/base-server.js) on every request. It's a
 * framework-internal call we can't change; the filter is scoped to that one
 * deprecation code so our own future deprecation warnings still surface.
 */
export function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const proc = process;
  const original = proc.emitWarning.bind(proc);
  proc["emitWarning"] = ((warning: string | Error, ...args: unknown[]) => {
    const code =
      typeof args[0] === "object" && args[0] !== null
        ? (args[0] as { code?: string }).code
        : args[1];
    if (code === "DEP0169") return;
    return (original as (...a: unknown[]) => void)(warning, ...args);
  }) as typeof proc.emitWarning;
}
