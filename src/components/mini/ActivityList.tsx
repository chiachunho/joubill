"use client";

import Link from "next/link";
import { ChevronRight, Lock } from "lucide-react";

import { Avatar } from "@/components/mini/Avatar";
import { dayLabel, stampLabel } from "@/lib/format";
import { labelUser } from "@/lib/label";
import { changeHeading, rateLockImpact } from "@/lib/record-audit";
import type { ActivityEntry } from "@/lib/record-history";

/**
 * The audit log, rendered.
 *
 * Shared by the group feed and a single record's history, and by `/mini` and
 * `/app` alike — the diffing already happens server-side (`record-history.ts`),
 * so what is left here is one row shape that all four views draw from. A second
 * copy of this would let "改了金額" mean two different things depending on where
 * you read it.
 */

type Props = {
  entries: ActivityEntry[];
  /** Photos keyed by user id, from the group's avatars endpoint. */
  photos?: Record<number, string | null>;
  currentUserId?: number;
  /** "/mini" or "/app" — the row links stay on the front end you came from. */
  appBase: string;
  groupId: string | number;
  /** Group feed names the record in each row; a record's own history doesn't. */
  showRecordLabel?: boolean;
  /**
   * Whether a row may link to its record's history. False on that history page
   * itself — every row there would link to the page you are already on, which
   * renders a chevron that promises navigation and then does nothing.
   */
  linkRows?: boolean;
  /** Day headings only make sense on the feed; a record's history is short. */
  groupByDay?: boolean;
};

function ChangeLine({ entry }: { entry: ActivityEntry }) {
  if (entry.rateLock) return <>{rateLockImpact(entry.rateLock)}</>;

  if (entry.changes?.length) {
    return (
      <>
        {entry.changes.map((c, i) => (
          <span key={c.key}>
            {i > 0 && " · "}
            {c.label}{" "}
            {/* Struck-through grey for the old value and solid for the new,
                deliberately not red/green: those two are reserved for the sign
                of an amount (docs/design-system.md), and reusing them here
                would read as a direction of money rather than of change. */}
            <span className="num line-through opacity-70">{c.before}</span>
            <span className="px-0.5 opacity-50">→</span>
            <span className="num font-semibold text-foreground">{c.after}</span>
            {c.detail && <span className="opacity-80"> · {c.detail}</span>}
          </span>
        ))}
      </>
    );
  }

  return <>{entry.summary}</>;
}

function Row({
  entry,
  photos,
  currentUserId,
  appBase,
  groupId,
  showRecordLabel,
  showDate,
  linkRows,
}: {
  entry: ActivityEntry;
  photos?: Record<number, string | null>;
  currentUserId?: number;
  appBase: string;
  groupId: string | number;
  showRecordLabel: boolean;
  showDate: boolean;
  linkRows: boolean;
}) {
  const who = entry.actor
    ? labelUser({ ...entry.actor, userId: entry.actor.userId }, currentUserId)
    : "?";

  const [date, time] = stampLabel(entry.at).split(" ");
  const stamp = { date, time };

  // A deleted record has nowhere to go, and a rate lock belongs to the group
  // rather than to any one row — neither is tappable.
  const href =
    linkRows &&
    entry.recordId != null &&
    entry.action !== "deleted" &&
    entry.action !== "rate_locked"
      ? `${appBase}/groups/${groupId}/activity?record=${entry.recordId}`
      : null;

  const body = (
    <>
      {entry.action === "rate_locked" ? (
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Lock className="size-3.5" />
        </span>
      ) : (
        <Avatar
          src={entry.actor ? photos?.[entry.actor.userId] : null}
          name={who}
          userId={entry.actor?.userId ?? 0}
          size="sm"
        />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-snug">
          <span className="font-semibold">{who}</span> {changeHeading(entry, showRecordLabel)}
        </p>
        <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
          <ChangeLine entry={entry} />
        </p>
      </div>
      <span className="num shrink-0 self-start pt-0.5 text-right text-xs leading-tight text-muted-foreground">
        {/* Day headings carry the date on the feed, so rows there show only a
            time; a record's own history has no headings and stacks both. */}
        {showDate ? (
          <>
            {stamp.date}
            <br />
            {stamp.time}
          </>
        ) : (
          stamp.time
        )}
      </span>
      {href && <ChevronRight className="size-3.5 shrink-0 self-center text-muted-foreground/70" />}
    </>
  );

  const className = "flex items-center gap-3 px-4 py-3";
  return href ? (
    <Link href={href} className={`${className} transition-colors hover:bg-accent/30 active:bg-accent/50`}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

export function ActivityList({
  entries,
  photos,
  currentUserId,
  appBase,
  groupId,
  showRecordLabel = false,
  groupByDay = false,
  linkRows = true,
}: Props) {
  if (!groupByDay) {
    return (
      <section className="px-4">
        <div className="divide-y divide-border/40 overflow-hidden rounded-2xl bg-secondary/50">
          {entries.map((e) => (
            <Row
              key={e.id}
              entry={e}
              photos={photos}
              currentUserId={currentUserId}
              appBase={appBase}
              groupId={groupId}
              showRecordLabel={showRecordLabel}
              showDate
              linkRows={linkRows}
            />
          ))}
        </div>
      </section>
    );
  }

  const byDay = new Map<string, ActivityEntry[]>();
  for (const e of entries) {
    const label = dayLabel(e.at);
    if (!byDay.has(label)) byDay.set(label, []);
    byDay.get(label)!.push(e);
  }

  return (
    <>
      {Array.from(byDay.entries()).map(([label, group]) => (
        <section key={label} className="px-4">
          <p className="sect mb-2.5">{label}</p>
          <div className="divide-y divide-border/40 overflow-hidden rounded-2xl bg-secondary/50">
            {group.map((e) => (
              <Row
                key={e.id}
                entry={e}
                photos={photos}
                currentUserId={currentUserId}
                appBase={appBase}
                groupId={groupId}
                showRecordLabel={showRecordLabel}
                showDate={false}
                linkRows={linkRows}
              />
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
