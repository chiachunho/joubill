import { memberLabels } from "@/lib/label";

/**
 * Turns the name an agent typed into a group member (issue #149). The agent only ever
 * hears what a person said, so a name can be wrong; **a wrong guess books money to the
 * wrong person**, so this matches exactly (after normalising) and otherwise answers with
 * the candidates and lets the agent ask. Only this group's members are considered.
 */

export type NameableMember = {
  id: number;
  displayName: string | null;
  firstName: string | null;
  lastName?: string | null;
  username: string | null;
};

export type Candidate = { memberId: number; label: string };

export type ResolveResult<M> =
  | { ok: true; member: M }
  | {
      ok: false;
      code: "member_not_found" | "member_ambiguous";
      query: string;
      candidates: Candidate[];
    };

const norm = (s: string) => s.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();

/** Every spelling by which a member may be called. */
function namesOf(m: NameableMember): string[] {
  const out = new Set<string>();
  const add = (s: string | null | undefined) => {
    const v = s ? norm(s) : "";
    if (v) out.add(v);
  };
  add(m.displayName);
  add(m.firstName);
  add([m.firstName, m.lastName].filter(Boolean).join(" "));
  add([m.lastName, m.firstName].filter(Boolean).join(""));
  if (m.username) {
    add(m.username);
    add(`@${m.username}`);
  }
  return [...out];
}

/** `ref` is a `memberId` (number) or a name; ids skip matching. */
export function resolveMember<M extends NameableMember>(
  ref: number | string,
  members: readonly M[],
): ResolveResult<M> {
  const labels = memberLabels(members);
  const toCandidate = (m: M): Candidate => ({ memberId: m.id, label: labels.get(m.id) ?? "?" });

  if (typeof ref === "number") {
    const hit = members.find((m) => m.id === ref);
    return hit
      ? { ok: true, member: hit }
      : {
          ok: false,
          code: "member_not_found",
          query: String(ref),
          candidates: members.map(toCandidate),
        };
  }

  const q = norm(ref);
  const hits = q ? members.filter((m) => namesOf(m).includes(q)) : [];
  if (hits.length === 1) return { ok: true, member: hits[0] };
  return hits.length === 0
    ? { ok: false, code: "member_not_found", query: ref, candidates: members.map(toCandidate) }
    : { ok: false, code: "member_ambiguous", query: ref, candidates: hits.map(toCandidate) };
}

const MAX_LISTED = 12;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

/**
 * The error text for a name that didn't resolve (issue #151). It names the candidates and
 * the next step, because the agent reads this message and nothing else may be at hand: the
 * only useful reaction is to ask the user and call again with a memberId.
 */
export function describeUnresolved(
  code: "member_not_found" | "member_ambiguous",
  query: string,
  candidates: readonly Candidate[],
): string {
  const q = clip(query, 40);
  const shown = candidates
    .slice(0, MAX_LISTED)
    .map((c) => `#${c.memberId} ${clip(c.label, 40)}`)
    .join("、");
  const more = candidates.length > MAX_LISTED ? `…等共 ${candidates.length} 位` : "";
  if (code === "member_ambiguous") {
    return `Found ${candidates.length} members matching "${q}": ${shown}${more}. Nothing was written. Ask the user which one they mean, then call again with that memberId.`;
  }
  return `No member of this group matches "${q}". Members: ${shown}${more}. Nothing was written. Ask the user who they mean (or call get_group), then call again with a memberId.`;
}
