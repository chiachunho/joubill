/**
 * A page that could not load (docs/design-system.md §7): a centred message and a thin
 * line of detail, the same shape the other pages write inline.
 */
export function LoadError({ detail }: { detail: string }) {
  return (
    <div className="px-4 py-12 text-center">
      <p className="text-sm text-muted-foreground">無法載入</p>
      <p className="mt-1 text-xs text-muted-foreground/60">{detail}</p>
    </div>
  );
}
