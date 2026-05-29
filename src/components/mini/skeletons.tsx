import { Skeleton } from "@/components/ui/skeleton";

/** Avatar + two text lines + a right-aligned amount — mirrors a list/balance row. */
function PanelRow() {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <Skeleton className="size-7 rounded-full" />
      <div className="flex-1 space-y-1.5">
        <Skeleton className="h-3.5 w-24" />
        <Skeleton className="h-2.5 w-16" />
      </div>
      <div className="space-y-1.5 text-right">
        <Skeleton className="ml-auto h-3.5 w-14" />
        <Skeleton className="ml-auto h-2.5 w-8" />
      </div>
    </div>
  );
}

/** A grouped panel of skeleton rows, matching the redesign's bg-secondary panels. */
function Panel({ rows }: { rows: number }) {
  return (
    <div className="divide-y divide-border/40 overflow-hidden rounded-2xl bg-secondary/50">
      {Array.from({ length: rows }).map((_, i) => (
        <PanelRow key={i} />
      ))}
    </div>
  );
}

/** Label + input field placeholder. */
function FieldSkeleton({ width = "w-16" }: { width?: string }) {
  return (
    <div className="space-y-2">
      <Skeleton className={`h-3 ${width}`} />
      <Skeleton className="h-10 w-full rounded-md" />
    </div>
  );
}

/** Group dashboard: nav + balances + transfers + month-grouped expenses. */
export function GroupPageSkeleton() {
  return (
    <div className="space-y-6 py-4">
      <div className="flex justify-end gap-1 px-4">
        <Skeleton className="h-7 w-20 rounded-xl" />
        <Skeleton className="h-7 w-16 rounded-xl" />
      </div>

      <section className="px-4">
        <Skeleton className="mb-2.5 h-3 w-24" />
        <Panel rows={3} />
      </section>

      <section className="px-4">
        <Skeleton className="mb-2.5 h-3 w-16" />
        <div className="space-y-2">
          <Skeleton className="h-[72px] w-full rounded-2xl" />
          <Skeleton className="h-[72px] w-full rounded-2xl" />
        </div>
      </section>

      <section className="px-4">
        <div className="mb-2.5 flex items-center justify-between">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-6 w-14 rounded-xl" />
        </div>
        <Skeleton className="mb-2 h-3 w-12" />
        <Panel rows={4} />
      </section>
    </div>
  );
}

/** Groups list home. */
export function GroupsListSkeleton() {
  return (
    <div className="py-6">
      <Skeleton className="mb-3 ml-4 h-3 w-20" />
      <div className="mx-4 divide-y divide-border/50 overflow-hidden rounded-2xl bg-secondary/50">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3.5">
            <Skeleton className="size-9 rounded-full" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-32" />
              <Skeleton className="h-2.5 w-10" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Settlements history list. */
export function SettlementsSkeleton() {
  return (
    <div className="space-y-6 py-4">
      <div className="flex items-center justify-between px-4">
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-6 w-14 rounded-xl" />
      </div>
      <div className="px-4">
        <Skeleton className="mb-2 h-3 w-12" />
        <Panel rows={4} />
      </div>
    </div>
  );
}

/** Stats page: header + two chart panels. */
export function StatsSkeleton() {
  return (
    <div className="space-y-6 py-4">
      <div className="space-y-1.5 px-4">
        <Skeleton className="h-6 w-16" />
        <Skeleton className="h-2.5 w-8" />
      </div>
      <section className="px-4">
        <Skeleton className="mb-2.5 h-3 w-28" />
        <div className="rounded-2xl bg-secondary/50 px-4 py-4">
          <Skeleton className="h-[220px] w-full rounded-xl" />
        </div>
      </section>
      <section className="px-4">
        <Skeleton className="mb-2.5 h-3 w-20" />
        <div className="rounded-2xl bg-secondary/50 px-4 py-4">
          <Skeleton className="h-[160px] w-full rounded-xl" />
        </div>
      </section>
    </div>
  );
}

/** Expense / settlement form. Expense adds the split-type toggle + participant panel. */
export function FormSkeleton({ variant }: { variant: "expense" | "settlement" }) {
  return (
    <div className="flex flex-col gap-5 px-4 py-4">
      <Skeleton className="h-6 w-28" />

      {variant === "expense" ? (
        <>
          <div className="flex gap-2">
            <div className="flex-1">
              <FieldSkeleton />
            </div>
            <div className="w-28">
              <FieldSkeleton />
            </div>
          </div>
          <FieldSkeleton />
          <FieldSkeleton />
          <FieldSkeleton />
          <div className="space-y-2">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-9 w-full rounded-xl" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-3 w-16" />
            <div className="divide-y divide-border/40 overflow-hidden rounded-2xl bg-secondary/50">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-3">
                  <Skeleton className="size-4 rounded" />
                  <Skeleton className="size-7 rounded-full" />
                  <Skeleton className="h-3.5 w-24 flex-1" />
                  <Skeleton className="h-9 w-24 rounded-md" />
                </div>
              ))}
            </div>
          </div>
        </>
      ) : (
        <>
          <FieldSkeleton width="w-28" />
          <FieldSkeleton width="w-28" />
          <div className="flex gap-2">
            <div className="flex-1">
              <FieldSkeleton />
            </div>
            <div className="w-28">
              <FieldSkeleton />
            </div>
          </div>
          <FieldSkeleton />
        </>
      )}

      <Skeleton className="h-10 w-full rounded-xl" />
    </div>
  );
}
