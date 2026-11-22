/**
 * A page that could not load (docs/design-system.md §7): a centred message and a thin
 * line of detail. Page bodies use this rather than writing the shape again; the one
 * exception is JoinPage, whose error offers a 重試 button.
 */
export function LoadError({ detail, title = "無法載入" }: { detail: string; title?: string }) {
  return (
    <div className="px-4 py-12 text-center">
      <p className="text-sm text-muted-foreground">{title}</p>
      <p className="mt-1 text-xs text-muted-foreground/60">{detail}</p>
    </div>
  );
}
