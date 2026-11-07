"use client";

import Link from "next/link";
import {
  ChevronRight,
  Clock,
  KeyRound,
  Link2,
  Link2Off,
  Lock,
  Sparkles,
  UserCheck,
  type LucideIcon,
} from "lucide-react";

import { IconTile } from "@/components/mini/IconTile";
import { Avatar } from "@/components/mini/Avatar";
import { activityFeedHref, recordHistoryHref } from "@/lib/activity-link";
import { viaText } from "@/lib/app-ui";
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

/** The group-level events, which have no one record to show and so wear an icon, not an avatar. */
const GROUP_EVENT_ICONS: Record<string, LucideIcon | undefined> = {
  rate_locked: Lock,
  invite_reset: KeyRound,
  chat_linked: Link2,
  chat_unlinked: Link2Off,
  timezone_changed: Clock,
  member_claimed: UserCheck,
  account_merged: UserCheck,
};

function ChangeLine({ entry }: { entry: ActivityEntry }) {
  if (entry.rateLock) return <>{rateLockImpact(entry.rateLock)}</>;

  if (entry.groupEvent?.claimedCount != null) {
    return <>{entry.groupEvent.claimedCount} 筆紀錄改記在他名下</>;
  }

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

  // A rate lock belongs to the group rather than to any one row, so it has no
  // history to open. A deleted record does: its log rows outlive it (`record_id`
  // has no foreign key), and that history is how you find out who removed it.
  const href =
    linkRows && entry.recordId != null && entry.action !== "rate_locked"
      ? recordHistoryHref({
          appBase,
          groupId,
          recordId: entry.recordId,
          // 返回 on the history page comes back to this feed.
          from: activityFeedHref({ appBase, groupId }),
        })
      : null;

  const EventIcon = GROUP_EVENT_ICONS[entry.action];

  const body = (
    <>
      {EventIcon ? (
        <IconTile icon={EventIcon} />
      ) : (
        <span className="relative shrink-0">
          <Avatar
            src={entry.actor ? photos?.[entry.actor.userId] : null}
            name={who}
            userId={entry.actor?.userId ?? 0}
            size="sm"
          />
          {entry.via && (
            // The corner mark for a change a linked application made, named for screen readers.
            <span
              role="img"
              aria-label={viaText(entry.via)}
              className="absolute -bottom-1 -right-1 flex size-3.5 items-center justify-center rounded-full bg-primary text-primary-foreground ring-2 ring-background"
            >
              <Sparkles className="size-2" />
            </span>
          )}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-snug">
          <span className="font-semibold">{who}</span>
          {entry.via && ` ${viaText(entry.via)}`} {changeHeading(entry, showRecordLabel)}
        </p>
        <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
          <ChangeLine entry={entry} />
        </p>
      </div>
      {/* Time top-right, chevron bottom-right, in a column of its own so a row
          without a chevron (a rate lock, a group event) keeps its time exactly
          where the others have it. */}
      <div className="flex min-h-9 shrink-0 flex-col items-end justify-between self-stretch">
        <span className="num text-right text-xs leading-tight text-muted-foreground">
          {/* Day headings carry the date on the feed, so rows there show only a
              time; a record's own history has no headings and shows both. */}
          {showDate ? `${stamp.date} ${stamp.time}` : stamp.time}
        </span>
        {href ? (
          <ChevronRight className="size-3.5 text-muted-foreground/70" />
        ) : (
          // Only where some rows link: on a record's own history none do, and
          // the spacer would just narrow every row's text.
          linkRows && <span className="size-3.5" aria-hidden />
        )}
      </div>
    </>
  );

  const className = "flex items-start gap-3 px-4 py-3";
  return href ? (
    <Link
      href={href}
      className={`${className} transition-colors hover:bg-accent/30 active:bg-accent/50`}
    >
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
