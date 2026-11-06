"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { skipToken } from "@reduxjs/toolkit/query";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  ArrowLeft,
  Calendar as CalendarIcon,
  Check,
  ChevronLeft,
  ChevronRight,
  ImagePlus,
  Loader2,
  Plus,
  X,
} from "lucide-react";

import { Avatar } from "@/components/mini/Avatar";
import { ConfirmDialog } from "@/components/mini/ConfirmDialog";
import { MemberSelect } from "@/components/mini/MemberSelect";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { dayToLocalDate, localDateToDay } from "@/lib/day";
import { apiErrorStatus, apiErrorText, deleteErrorMessage } from "@/lib/api-error";
import { rateSourceLabel } from "@/lib/rate-source-label";
import { recordHistoryHref } from "@/lib/activity-link";
import { stampLabel } from "@/lib/format";
import { viaText } from "@/lib/app-ui";
import { labelUser, memberLabels } from "@/lib/label";
import { computeSplits } from "@/lib/splits";
import { n, splitEqual } from "@/lib/money";
import { cn } from "@/lib/utils";
import { useAuthMode } from "@/components/AuthProvider";
import { useTelegramBackButton } from "@/lib/use-tg-back-button";
import { tmaRawFetch } from "@/lib/tma-fetch";
import { webRawFetch } from "@/lib/web-fetch";
import { SUPPORTED_CURRENCIES, expenseFormSchema, type ExpenseFormValues } from "@/lib/zod";
import {
  useCreateExpenseMutation,
  useDeleteExpenseMutation,
  useGetEffectiveRateQuery,
  useUpdateExpenseMutation,
} from "@/store/api";

type Member = {
  id: number;
  displayName: string | null;
  firstName: string;
  lastName?: string | null;
  username: string | null;
  status?: string | null;
};
type MultiPayerEntry = { userId: number; included: boolean; amount: string };

type Initial = {
  id: number;
  /** Required, not optional: an omitted field here is exactly how the
   *  attribution silently stopped rendering once before. */
  createdBy: number | null;
  /** When it was entered — distinct from spentAt, which is the date of the
   *  expense itself and is an editable field. Required for the same reason
   *  createdBy is: an optional attribution field silently rendered nothing
   *  once already. */
  createdAt: string | null;
  /** The AI assistant it was entered through (issue #150): required, like createdBy. */
  createdVia: string | null;
  /** The most recent edit, or null when nobody has touched it since. */
  lastActivity: { actorId: number | null; at: string; via: string | null } | null;
  amount: number;
  currency: string;
  fxRate?: number | null;
  fxQuote?: string | null;
  description: string | null;
  payers: Array<{ payerId: number; amount: number }>;
  spentAt: string;
  receiptFileIds?: string[];
  /** Signed `/api/tg-photo` link for each receipt id (an <img> cannot send the auth header). */
  receiptUrls: Record<string, string>;
  splits: Array<{
    debtorId: number;
    amount: number;
    shareType: string;
    splitValue?: number | null;
  }>;
};

type Props = {
  groupId: number;
  defaultCurrency: string;
  currentUserId: number;
  members: Member[];
  photos?: Record<number, string | null>;
  initial?: Initial;
  /** Where to navigate after save/delete. Defaults to /mini/groups/:groupId. */
  returnPath?: string;
};

function distributePayerAmounts(
  entries: MultiPayerEntry[],
  locked: Set<number>,
  total: number,
): MultiPayerEntry[] {
  const { lockedSum, unlocked } = entries.reduce(
    (acc, e) => {
      if (!e.included) return acc;
      if (locked.has(e.userId)) acc.lockedSum += parseFloat(e.amount) || 0;
      else acc.unlocked.push(e);
      return acc;
    },
    { lockedSum: 0, unlocked: [] as MultiPayerEntry[] },
  );
  if (unlocked.length === 0) return entries;
  const shares = splitEqual(Math.max(total - lockedSum, 0), unlocked.length);
  const newAmounts = new Map(unlocked.map((e, i) => [e.userId, shares[i].toFixed(2)]));
  return entries.map((e) => ({
    ...e,
    amount: newAmounts.has(e.userId) ? newAmounts.get(e.userId)! : e.amount,
  }));
}

function buildDefaults(props: Props): ExpenseFormValues {
  const { members, initial, defaultCurrency, currentUserId } = props;
  const initialSplits = initial?.splits ?? [];
  const initialShareType = initialSplits[0]?.shareType;
  // Use the stored shareType as-is when splitValues are available to restore inputs.
  // For shares/adjustment/percent without splitValues (old records), fall back to exact.
  const hasSplitValues =
    initialSplits.length > 0 && initialSplits.every((s) => s.splitValue != null);
  const shareType: ExpenseFormValues["shareType"] =
    !initialShareType || initialShareType === "equal"
      ? "equal"
      : initialShareType === "exact"
        ? "exact"
        : hasSplitValues
          ? (initialShareType as ExpenseFormValues["shareType"])
          : "exact";
  // Use splitValue (raw input) when available; otherwise fall back to computed amount.
  const splitByDebtor = new Map(initialSplits.map((s) => [s.debtorId, s.splitValue ?? s.amount]));
  return {
    amount: initial ? initial.amount.toFixed(2) : "",
    currency: (initial?.currency ?? defaultCurrency) as ExpenseFormValues["currency"],
    // Restore a pinned rate only while it still targets the group's current
    // default currency; a dormant pin (default changed since) starts blank.
    fxRate:
      initial?.fxRate != null && initial.fxQuote === defaultCurrency ? String(initial.fxRate) : "",
    description: initial?.description ?? "",
    payers: initial?.payers.length
      ? initial.payers.map((p) => ({ userId: String(p.payerId), amount: p.amount.toFixed(2) }))
      : [{ userId: String(currentUserId), amount: initial ? initial.amount.toFixed(2) : "" }],
    spentDate: initial ? dayToLocalDate(initial.spentAt) : new Date(),
    shareType,
    participants: members.map((m) => {
      const rawVal = splitByDebtor.get(m.id);
      return {
        userId: m.id,
        included: initial ? rawVal !== undefined : m.status !== "inactive",
        // Strip trailing zeros from split values (e.g. "2.0000" → "2", "33.3300" → "33.33")
        value: rawVal !== undefined ? String(parseFloat(rawVal.toFixed(4))) : "",
      };
    }),
  };
}

export function ExpenseForm(props: Props) {
  const { groupId, members, photos, initial, returnPath } = props;
  // Display names are free text, so two members can read the same; the payer and participant
  // rows must still be told apart.
  const labels = useMemo(() => memberLabels(members), [members]);
  const router = useRouter();
  const pathname = usePathname();
  const mode = useAuthMode();
  // "tma" → /mini, "web" → /app. Same split the fetchers make below.
  const appBase = mode === "web" ? "/app" : "/mini";
  const isEdit = !!initial;
  const back = returnPath ?? `/mini/groups/${groupId}`;

  // Anyone in the group may edit or delete any record, so who entered it is
  // shown rather than enforced — attribution in place of a lock (see CLAUDE.md).
  const createdBy = initial?.createdBy;
  const recordedBy = useMemo(() => {
    if (createdBy == null) return null;
    const m = members.find((x) => x.id === createdBy);
    return m ? labelUser({ ...m, userId: m.id }, props.currentUserId) : null;
  }, [createdBy, members, props.currentUserId]);
  const recordedBySomeoneElse = createdBy != null && createdBy !== props.currentUserId;

  // Only rendered once someone has actually edited the record: until then
  // "由 X 記錄" above already says everything there is to know.
  const lastEdit = useMemo(() => {
    const activity = initial?.lastActivity;
    if (!activity) return null;
    const m = members.find((x) => x.id === activity.actorId);
    return {
      by: m ? labelUser({ ...m, userId: m.id }, props.currentUserId) : "?",
      at: activity.at,
      via: activity.via,
    };
  }, [initial?.lastActivity, members, props.currentUserId]);

  const backToGroup = useCallback(() => {
    router.push(back);
  }, [router, back]);
  useTelegramBackButton(backToGroup);

  const form = useForm<ExpenseFormValues>({
    resolver: zodResolver(expenseFormSchema),
    defaultValues: buildDefaults(props),
    mode: "onChange",
  });
  const { fields, replace } = useFieldArray({ control: form.control, name: "participants" });
  const { replace: replacePayerFields } = useFieldArray({
    control: form.control,
    name: "payers",
  });

  // Persist participant values per shareType so switching away and back restores the original inputs.
  const savedValuesByType = useRef<Partial<Record<ExpenseFormValues["shareType"], string[]>>>(
    (() => {
      const v = form.getValues();
      return { [v.shareType]: v.participants.map((p) => p.value) } as Partial<
        Record<ExpenseFormValues["shareType"], string[]>
      >;
    })(),
  );

  // Track which participant userId's have been manually set by the user (for auto-distribution).
  const lockedParticipants = useRef<Set<number>>(new Set());

  const [multiPayerMode, setMultiPayerMode] = useState<boolean>(
    () => (initial?.payers.length ?? 0) > 1,
  );
  const [multiPayerEntries, setMultiPayerEntries] = useState<MultiPayerEntry[]>(() => {
    if ((initial?.payers.length ?? 0) > 1) {
      const payerMap = new Map(initial!.payers.map((p) => [p.payerId, p.amount]));
      const base = members.map((m) => ({
        userId: m.id,
        included: payerMap.has(m.id),
        amount: payerMap.has(m.id) ? payerMap.get(m.id)!.toFixed(2) : "",
      }));
      // Carry payers that are no longer group members (e.g. removed after the
      // expense was created) so their saved amount isn't silently dropped on save.
      const memberIds = new Set(members.map((m) => m.id));
      const orphanPayers = initial!.payers
        .filter((p) => !memberIds.has(p.payerId))
        .map((p) => ({ userId: p.payerId, included: true, amount: p.amount.toFixed(2) }));
      return [...base, ...orphanPayers];
    }
    return [];
  });
  // Treat already-saved payer amounts as locked so the mount-time redistribute effect
  // doesn't overwrite them with an even split (e.g. saved 70/30 → shown 50/50).
  const lockedPayerAmounts = useRef<Set<number>>(
    new Set((initial?.payers.length ?? 0) > 1 ? initial!.payers.map((p) => p.payerId) : []),
  );

  function distributeRemainder(type: "exact" | "percent") {
    const total = type === "percent" ? 100 : n(form.getValues("amount")) || 0;
    const current = form.getValues("participants");
    const locked = lockedParticipants.current;
    const indexByUserId = new Map(current.map((p, i) => [p.userId, i]));
    const { lockedSum, unlocked } = current.reduce(
      (acc, p) => {
        if (!p.included) return acc;
        if (locked.has(p.userId)) acc.lockedSum += n(p.value) || 0;
        else acc.unlocked.push(p);
        return acc;
      },
      { lockedSum: 0, unlocked: [] as typeof current },
    );
    if (unlocked.length === 0) return;
    const shares = splitEqual(Math.max(total - lockedSum, 0), unlocked.length);
    unlocked.forEach((p, idx) => {
      const i = indexByUserId.get(p.userId);
      if (i !== undefined) form.setValue(`participants.${i}.value`, String(shares[idx]));
    });
  }

  function makeDistributeHandlers(
    type: "exact" | "percent",
    userId: number,
    field: { onChange: (v: string) => void; onBlur: () => void },
  ) {
    return {
      onFocus(e: React.FocusEvent<HTMLInputElement>) {
        field.onChange("");
        e.target.value = "";
      },
      onBlur(e: React.FocusEvent<HTMLInputElement>) {
        field.onBlur();
        if (!e.target.value) lockedParticipants.current.delete(userId);
        else lockedParticipants.current.add(userId);
        distributeRemainder(type);
      },
    };
  }

  function enterMultiPayerMode() {
    const currentPayerId = Number(form.getValues("payers.0.userId"));
    const totalAmt = parseFloat(form.getValues("amount")) || 0;
    lockedPayerAmounts.current = new Set();
    const base = members.map((m) => ({
      userId: m.id,
      included: m.id === currentPayerId,
      amount: "",
    }));
    setMultiPayerEntries(distributePayerAmounts(base, new Set(), totalAmt));
    setMultiPayerMode(true);
  }

  function togglePayerIncluded(userId: number, checked: boolean) {
    lockedPayerAmounts.current.delete(userId);
    setMultiPayerEntries((prev) => {
      const next = prev.map((e) =>
        e.userId === userId ? { ...e, included: checked, amount: checked ? e.amount : "" } : e,
      );
      return distributePayerAmounts(next, lockedPayerAmounts.current, parseFloat(amount) || 0);
    });
  }

  function makeMultiPayerAmountHandlers(userId: number) {
    return {
      onFocus() {
        setMultiPayerEntries((prev) =>
          prev.map((e) => (e.userId === userId ? { ...e, amount: "" } : e)),
        );
      },
      onChange(ev: React.ChangeEvent<HTMLInputElement>) {
        const val = ev.target.value;
        setMultiPayerEntries((prev) =>
          prev.map((e) => (e.userId === userId ? { ...e, amount: val } : e)),
        );
      },
      onBlur(ev: React.FocusEvent<HTMLInputElement>) {
        const val = ev.target.value;
        if (!val) lockedPayerAmounts.current.delete(userId);
        else lockedPayerAmounts.current.add(userId);
        setMultiPayerEntries((prev) => {
          const next = prev.map((e) => (e.userId === userId ? { ...e, amount: val } : e));
          return distributePayerAmounts(next, lockedPayerAmounts.current, parseFloat(amount) || 0);
        });
      },
    };
  }

  const amount = useWatch({ control: form.control, name: "amount" });
  const currency = useWatch({ control: form.control, name: "currency" });
  const spentDate = useWatch({ control: form.control, name: "spentDate" });
  const shareType = useWatch({ control: form.control, name: "shareType" });
  const participants = useWatch({ control: form.control, name: "participants" });
  const payers = useWatch({ control: form.control, name: "payers" });

  // A rate typed for one currency is meaningless for another — clear the field
  // when the currency changes, restoring the saved pin when switching back to
  // the record's stored currency.
  useEffect(() => {
    const restored =
      initial?.fxRate != null &&
      initial.fxQuote === props.defaultCurrency &&
      currency === initial.currency
        ? String(initial.fxRate)
        : "";
    if (form.getValues("fxRate") !== restored) {
      form.setValue("fxRate", restored, { shouldValidate: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currency]);

  // Reference rate for the FX field (group custom rate if set, else market rate
  // as of the spend date). Goes through the surrounding store, so it works in
  // both the Mini App and the Web App.
  const isForeignCurrency = currency !== props.defaultCurrency;
  // `data` keeps the previous date's result while the new one loads, so nothing derived
  // from it is shown while `isFetching` (the ≈ line is a skeleton instead).
  const {
    data: effectiveRate,
    currentData: currentRate,
    isFetching,
  } = useGetEffectiveRateQuery(
    isForeignCurrency ? { groupId, base: currency, date: localDateToDay(spentDate) } : skipToken,
  );
  // Only a load for a NEW date counts; a background refresh of the same date keeps the value.
  const rateFetching = isFetching && currentRate === undefined;
  const [createExpense] = useCreateExpenseMutation();
  const [updateExpense] = useUpdateExpenseMutation();
  const [deleteExpense] = useDeleteExpenseMutation();

  // Single mode: keep the lone payer's amount equal to the total.
  useEffect(() => {
    if (!multiPayerMode) form.setValue("payers.0.amount", amount, { shouldValidate: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount, multiPayerMode]);

  // Multi mode: redistribute unlocked payers when the total changes. Keyed on `amount`
  // only — never on payers.length, or focus-clearing a field would feed back and refill it.
  useEffect(() => {
    if (multiPayerMode) {
      setMultiPayerEntries((prev) =>
        distributePayerAmounts(prev, lockedPayerAmounts.current, parseFloat(amount) || 0),
      );
    }
  }, [amount, multiPayerMode]);

  // Reconcile members that load/join after mount (e.g. a background refetch) into the
  // payer entries so they become selectable; existing entries keep their edited state.
  // Done while rendering rather than in an effect: it converges (once every member has an
  // entry there is nothing left to add), and no frame shows a member without a row.
  if (multiPayerMode) {
    const known = new Set(multiPayerEntries.map((e) => e.userId));
    const additions = members
      .filter((m) => !known.has(m.id))
      .map((m) => ({ userId: m.id, included: false, amount: "" }));
    if (additions.length > 0) setMultiPayerEntries([...multiPayerEntries, ...additions]);
  }

  // Keep the form's payers field in sync with multi-payer entries so zod validation fires correctly
  useEffect(() => {
    if (!multiPayerMode) return;
    const active = multiPayerEntries
      .filter((e) => e.included && parseFloat(e.amount) > 0)
      .map((e) => ({ userId: String(e.userId), amount: e.amount }));
    replacePayerFields(active.length > 0 ? active : [{ userId: "", amount: "" }]);
    // `replace` is programmatic, so isValid won't recompute on its own — trigger it
    // explicitly or the submit button's enabled state lags behind payer edits.
    void form.trigger("payers");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [multiPayerMode, multiPayerEntries]);

  const totalAmount = parseFloat(amount) || 0;
  const payerSum = multiPayerMode
    ? multiPayerEntries
        .filter((e) => e.included)
        .reduce((s, e) => s + (parseFloat(e.amount) || 0), 0)
    : payers.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0);
  const payersBalanced = totalAmount > 0 && Math.abs(payerSum - totalAmount) < 0.005;

  const included = participants
    .filter((p) => p.included)
    .map((p) => ({ userId: p.userId, value: p.value }));
  const computedSplits = computeSplits(totalAmount, shareType, included);
  const inputSum = included.reduce((s, p) => s + (parseFloat(p.value) || 0), 0);
  const splitsBalanced =
    shareType === "equal"
      ? true
      : shareType === "percent"
        ? Math.abs(inputSum - 100) < 0.005
        : shareType === "shares"
          ? inputSum > 0
          : shareType === "adjustment"
            ? inputSum <= totalAmount && totalAmount > 0
            : Math.abs(inputSum - totalAmount) < 0.005;

  // Default value per userId for shares inputs (used for focus-clear / blur-restore UX).
  const defaultValueByUserId = new Map<number, string>();
  if (shareType === "shares") included.forEach((p) => defaultValueByUserId.set(p.userId, "1"));

  const adjBases = (() => {
    if (shareType !== "adjustment" || included.length === 0) return new Map<number, number>();
    const adjBaseTotal = Math.max(totalAmount - inputSum, 0);
    const bases = splitEqual(adjBaseTotal, included.length);
    return new Map(included.map((p, idx) => [p.userId, bases[idx]]));
  })();
  const allIncluded = participants.every((p) => p.included);

  async function onSubmit(values: ExpenseFormValues) {
    const initialSplits = initial?.splits ?? [];
    const initialShareType = initialSplits[0]?.shareType as
      ExpenseFormValues["shareType"] | undefined;
    // Old records without splitValues (pre-migration) load as "exact" in buildDefaults.
    // Preserve the original stored shareType so a description-only edit doesn't corrupt the DB.
    const RESTORABLE = new Set<string>(["percent", "shares", "adjustment"]);
    const loadedAsExactFallback =
      values.shareType === "exact" &&
      initialShareType !== undefined &&
      RESTORABLE.has(initialShareType) &&
      !initialSplits.every((s) => s.splitValue != null);
    const submittedShareType = loadedAsExactFallback ? initialShareType! : values.shareType;

    // Store raw inputs for percent/shares/adjustment so editing restores the original type.
    const NEEDS_RAW = new Set<string>(["percent", "shares", "adjustment"]);
    const storeRawValue = NEEDS_RAW.has(submittedShareType);

    // Build map of userId → raw input value (null when blank/NaN — not the same as zero).
    const rawValueByUserId = new Map(
      values.participants
        .filter((p) => p.included)
        .map((p) => {
          const v = parseFloat(p.value);
          return [p.userId, Number.isFinite(v) ? v : null] as const;
        }),
    );

    const body = {
      amount: parseFloat(values.amount),
      currency: values.currency,
      fxRate:
        values.currency !== props.defaultCurrency && values.fxRate !== ""
          ? parseFloat(values.fxRate)
          : null,
      description: values.description.trim() || null,
      payers: values.payers.map((p) => ({
        payerId: Number(p.userId),
        amount: parseFloat(p.amount),
      })),
      spentAt: localDateToDay(values.spentDate),
      shareType: submittedShareType,
      receiptFileIds,
      splits: computedSplits.map((s) => ({
        ...s,
        splitValue: storeRawValue ? (rawValueByUserId.get(s.debtorId) ?? null) : null,
      })),
    };

    // Saving invalidates the lists, balance, stats, activity and this record's detail
    // (see `ledgerTags` in src/store/api.ts), so nothing here names a cache key.
    try {
      if (isEdit) {
        await updateExpense({ groupId, expenseId: initial!.id, body }).unwrap();
      } else {
        await createExpense({ groupId, body }).unwrap();
      }
    } catch (e) {
      form.setError("root", {
        message: apiErrorText(e, `HTTP ${apiErrorStatus(e) ?? "error"}`),
      });
      return;
    }
    router.push(back);
  }

  const [receiptFileIds, setReceiptFileIds] = useState<string[]>(initial?.receiptFileIds ?? []);
  const [receiptUrls, setReceiptUrls] = useState<Record<string, string>>(
    initial?.receiptUrls ?? {},
  );
  const [receiptUploading, setReceiptUploading] = useState(false);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const [loadedFileIds, setLoadedFileIds] = useState<Set<string>>(
    () => new Set(initial?.receiptFileIds ?? []),
  );
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleReceiptChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    const remaining = 5 - receiptFileIds.length;
    const toUpload = files.slice(0, remaining);
    setReceiptError(null);
    setReceiptUploading(true);
    try {
      const fetchFn = mode === "web" ? webRawFetch : tmaRawFetch;
      const results = await Promise.allSettled(
        toUpload.map(async (file) => {
          const body = new FormData();
          body.append("file", file);
          const res = await fetchFn("/api/tg-upload", { method: "POST", body });
          if (!res.ok) {
            const parsed = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
            throw new Error(parsed.error ?? "上傳失敗");
          }
          const { fileId, url } = (await res.json()) as { fileId: string; url: string };
          return { fileId, url };
        }),
      );
      const succeeded = results
        .filter(
          (r): r is PromiseFulfilledResult<{ fileId: string; url: string }> =>
            r.status === "fulfilled",
        )
        .map((r) => r.value);
      const failedCount = results.filter((r) => r.status === "rejected").length;
      // Cap at 5 in the updater in case `remaining` was computed from stale closure state.
      if (succeeded.length > 0) {
        setReceiptUrls((prev) => ({
          ...prev,
          ...Object.fromEntries(succeeded.map((s) => [s.fileId, s.url])),
        }));
        setReceiptFileIds((prev) => [...prev, ...succeeded.map((s) => s.fileId)].slice(0, 5));
      }
      if (failedCount > 0)
        setReceiptError(failedCount === 1 ? "1 張照片上傳失敗" : `${failedCount} 張照片上傳失敗`);
    } finally {
      setReceiptUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function removeReceipt(index: number) {
    setReceiptFileIds((prev) => prev.filter((_, i) => i !== index));
  }

  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleDelete() {
    if (!initial) return;
    setDeletePending(true);
    try {
      await deleteExpense({ groupId, expenseId: initial.id }).unwrap();
    } catch (e) {
      setDeletePending(false);
      setDeleteError(deleteErrorMessage({ status: apiErrorStatus(e) ?? 0 }, "這筆支出"));
      return;
    }
    setDeletePending(false);
    router.push(back);
  }

  return (
    <>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-5 px-4 py-4">
          {/* Header */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              {mode === "web" && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="shrink-0 rounded-lg"
                  onClick={backToGroup}
                >
                  <ArrowLeft className="size-4" />
                </Button>
              )}
              <h1 className="text-lg font-semibold">{isEdit ? "編輯支出" : "新增支出"}</h1>
            </div>
          </div>

          {/* Amount + currency row */}
          <div className="flex gap-2">
            <FormField
              control={form.control}
              name="amount"
              render={({ field }) => (
                <FormItem className="flex-1">
                  <FormLabel>金額</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      step="0.01"
                      min="0.01"
                      inputMode="decimal"
                      className="num text-base font-semibold"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="currency"
              render={({ field }) => (
                <FormItem className="w-28">
                  <FormLabel>幣別</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {SUPPORTED_CURRENCIES.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormItem>
              )}
            />
          </div>

          {/* Custom FX rate (foreign-currency expenses only) */}
          {isForeignCurrency && (
            <FormField
              control={form.control}
              name="fxRate"
              render={({ field }) => {
                const typed = parseFloat(field.value);
                const usingCustom = field.value !== "" && Number.isFinite(typed) && typed > 0;
                const rateInUse = usingCustom ? typed : (effectiveRate?.rate ?? null);
                return (
                  <FormItem>
                    <FormLabel>
                      匯率（1 {currency} = ? {props.defaultCurrency}）
                    </FormLabel>
                    <div className="relative">
                      <FormControl>
                        <Input
                          type="number"
                          step="any"
                          min="0"
                          inputMode="decimal"
                          className="num"
                          placeholder={
                            effectiveRate?.rate != null && !rateFetching
                              ? `${effectiveRate.rate}（${rateSourceLabel(effectiveRate)}）`
                              : rateFetching
                                ? ""
                                : "無法取得匯率，請手動輸入"
                          }
                          {...field}
                        />
                      </FormControl>
                      {field.value === "" && rateFetching && (
                        <Skeleton className="pointer-events-none absolute left-3 top-1/2 h-4 w-20 -translate-y-1/2" />
                      )}
                    </div>
                    {!usingCustom && rateFetching && totalAmount > 0 ? (
                      <Skeleton className="h-4 w-48" />
                    ) : rateInUse != null && totalAmount > 0 ? (
                      <p className="num text-xs text-muted-foreground">
                        ≈ {(totalAmount * rateInUse).toFixed(2)} {props.defaultCurrency}
                      </p>
                    ) : null}
                    <FormMessage />
                  </FormItem>
                );
              }}
            />
          )}

          {/* Date */}
          <FormField
            control={form.control}
            name="spentDate"
            render={({ field }) => (
              <FormItem>
                <FormLabel>日期</FormLabel>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full justify-start text-base font-normal md:text-sm"
                    >
                      <CalendarIcon />
                      {localDateToDay(field.value)}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={field.value}
                      onSelect={(d) => d && field.onChange(d)}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </FormItem>
            )}
          />

          {/* Description */}
          <FormField
            control={form.control}
            name="description"
            render={({ field }) => (
              <FormItem>
                <FormLabel>說明</FormLabel>
                <FormControl>
                  <Input placeholder="例如：晚餐、機票" maxLength={500} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Receipt photos */}
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium leading-none">收據照片</span>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={handleReceiptChange}
            />
            {receiptFileIds.length > 0 ? (
              <div className="grid grid-cols-3 gap-1.5">
                {receiptFileIds.map((fileId, i) => (
                  <div
                    key={fileId}
                    className="relative aspect-square overflow-hidden rounded-lg bg-secondary/50"
                  >
                    {!loadedFileIds.has(fileId) && (
                      <Skeleton className="absolute inset-0 rounded-none" />
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setLightboxIndex(i);
                        setLightboxOpen(true);
                      }}
                      className="absolute inset-0"
                      aria-label={`查看第 ${i + 1} 張收據大圖`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={receiptUrls[fileId]}
                        alt={`收據 ${i + 1}`}
                        className="h-full w-full object-cover"
                        onLoad={() => setLoadedFileIds((prev) => new Set([...prev, fileId]))}
                        onError={() => setLoadedFileIds((prev) => new Set([...prev, fileId]))}
                      />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeReceipt(i)}
                      className="absolute right-1 top-1 rounded-md bg-black/50 p-1 text-white backdrop-blur-sm"
                      aria-label="移除此收據"
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                ))}
                {receiptFileIds.length < 5 && (
                  <button
                    type="button"
                    disabled={receiptUploading}
                    onClick={() => fileInputRef.current?.click()}
                    className="flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-input bg-secondary/30 text-muted-foreground hover:bg-secondary/60 disabled:opacity-50"
                  >
                    {receiptUploading ? (
                      <Loader2 className="size-5 animate-spin" />
                    ) : (
                      <>
                        <ImagePlus className="size-5" />
                        <span className="text-xs">{receiptFileIds.length}/5</span>
                      </>
                    )}
                  </button>
                )}
              </div>
            ) : (
              <button
                type="button"
                disabled={receiptUploading}
                onClick={() => fileInputRef.current?.click()}
                className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-input bg-secondary/30 py-4 text-sm text-muted-foreground hover:bg-secondary/60 disabled:opacity-50"
              >
                {receiptUploading ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <ImagePlus className="size-4" />
                )}
                {receiptUploading ? "上傳中…" : "附上收據照片"}
              </button>
            )}
            {receiptError && <p className="text-sm text-destructive">{receiptError}</p>}
          </div>

          {/* Payers */}
          <FormField
            control={form.control}
            name="payers"
            render={() => (
              <FormItem>
                <FormLabel>付款人</FormLabel>
                {multiPayerMode ? (
                  <>
                    <div className="divide-y divide-border/40 overflow-hidden rounded-2xl bg-secondary/50">
                      {multiPayerEntries.map((entry) => {
                        const m = members.find((x) => x.id === entry.userId);
                        return (
                          <div
                            key={entry.userId}
                            className="flex min-h-[60px] items-center gap-3 px-4 py-3"
                          >
                            <Checkbox
                              checked={entry.included}
                              onCheckedChange={(c) => togglePayerIncluded(entry.userId, c === true)}
                            />
                            <Avatar
                              src={photos?.[entry.userId] ?? null}
                              name={m ? labels.get(m.id)! : String(entry.userId)}
                              userId={entry.userId}
                              size="sm"
                            />
                            <div className="min-w-0 flex-1 truncate text-sm leading-tight">
                              {m ? labels.get(m.id)! : `#${entry.userId}`}
                            </div>
                            {entry.included && (
                              <Input
                                type="number"
                                step="0.01"
                                min="0"
                                inputMode="decimal"
                                className="num w-24 shrink-0 text-right"
                                value={entry.amount}
                                {...makeMultiPayerAmountHandlers(entry.userId)}
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {totalAmount > 0 && (
                      <div className="rounded-2xl bg-secondary/50 px-4 py-3">
                        <div
                          className={cn(
                            "num flex items-center gap-1.5 text-sm",
                            payersBalanced ? "text-muted-foreground" : "text-rose-500",
                          )}
                        >
                          已付 {payerSum.toFixed(2)} / {totalAmount.toFixed(2)} {currency}
                          {!payersBalanced && (
                            <> · 差 {Math.abs(totalAmount - payerSum).toFixed(2)}</>
                          )}
                          {payersBalanced ? (
                            <Check className="size-3.5 shrink-0" />
                          ) : (
                            <X className="size-3.5 shrink-0" />
                          )}
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <FormField
                      control={form.control}
                      name="payers.0.userId"
                      render={({ field, fieldState }) => (
                        <FormItem>
                          <FormControl>
                            <MemberSelect
                              value={field.value}
                              onValueChange={field.onChange}
                              members={members}
                              photos={photos}
                              placeholder="選擇付款人"
                            />
                          </FormControl>
                          {fieldState.error && <FormMessage />}
                        </FormItem>
                      )}
                    />
                    <button
                      type="button"
                      onClick={enterMultiPayerMode}
                      className="flex items-center gap-1.5 text-sm text-primary transition-opacity hover:underline"
                    >
                      <Plus className="size-3.5" />
                      新增付款人
                    </button>
                  </>
                )}
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Split type */}
          <FormField
            control={form.control}
            name="shareType"
            render={({ field }) => (
              <FormItem>
                <FormLabel>分帳方式</FormLabel>
                <div className="inline-flex w-full rounded-lg border border-input bg-secondary/40 p-0.5">
                  {(["equal", "exact", "percent", "shares", "adjustment"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => {
                        // Save current values before switching away.
                        savedValuesByType.current[field.value as ExpenseFormValues["shareType"]] =
                          participants.map((p) => p.value);
                        lockedParticipants.current = new Set();

                        field.onChange(m);

                        // If we have saved values for the target type, restore them.
                        const saved = savedValuesByType.current[m];
                        if (saved) {
                          replace(fields.map((f, i) => ({ ...f, value: saved[i] ?? "" })));
                          return;
                        }

                        // Otherwise use new-record defaults.
                        if (m === "exact" || m === "percent") {
                          // Pre-fill with equal-split values so users only need to adjust differences.
                          const total = m === "percent" ? 100 : totalAmount;
                          const includedCount = included.length;
                          if (includedCount > 0 && total > 0) {
                            const equalAmounts = splitEqual(total, includedCount);
                            let idx = 0;
                            replace(
                              fields.map((f, i) => ({
                                ...f,
                                value: participants[i]?.included
                                  ? equalAmounts[idx++].toFixed(2)
                                  : "",
                              })),
                            );
                          } else {
                            replace(fields.map((f) => ({ ...f, value: "" })));
                          }
                        } else {
                          const defaultValue = m === "shares" ? "1" : m === "adjustment" ? "0" : "";
                          replace(fields.map((f) => ({ ...f, value: defaultValue })));
                        }
                      }}
                      aria-pressed={field.value === m}
                      className={cn(
                        "flex-1 rounded-md px-2 py-1.5 text-sm font-medium transition-all",
                        field.value === m
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {
                        {
                          equal: "均分",
                          exact: "指定",
                          percent: "比例",
                          shares: "份數",
                          adjustment: "調整",
                        }[m]
                      }
                    </button>
                  ))}
                </div>
              </FormItem>
            )}
          />

          {/* Participants */}
          <FormField
            control={form.control}
            name="participants"
            render={() => (
              <FormItem>
                <FormLabel>參與者</FormLabel>
                <div className="divide-y divide-border/40 overflow-hidden rounded-2xl bg-secondary/50">
                  {fields.map((f, i) => {
                    const m = members.find((x) => x.id === f.userId);
                    const isIncluded = participants[i]?.included ?? false;
                    const computed = computedSplits.find((x) => x.debtorId === f.userId);
                    return (
                      <div key={f.id} className="flex min-h-[60px] items-center gap-3 px-4 py-3">
                        <FormField
                          control={form.control}
                          name={`participants.${i}.included`}
                          render={({ field }) => (
                            <Checkbox
                              checked={field.value}
                              onCheckedChange={(c) => field.onChange(c === true)}
                            />
                          )}
                        />
                        <Avatar
                          src={photos?.[f.userId] ?? null}
                          name={m ? labels.get(m.id)! : String(f.userId)}
                          userId={f.userId}
                          size="sm"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm leading-tight">
                            {m ? labels.get(m.id)! : `#${f.userId}`}
                          </div>
                          {shareType === "shares" && isIncluded && computed && (
                            <div className="num mt-0.5 text-xs text-muted-foreground">
                              {computed.amount.toFixed(2)} {currency}
                            </div>
                          )}
                          {shareType === "adjustment" && isIncluded && adjBases.has(f.userId) && (
                            <div className="num mt-0.5 text-xs text-muted-foreground">
                              {(
                                adjBases.get(f.userId)! + (parseFloat(participants[i]?.value) || 0)
                              ).toFixed(2)}{" "}
                              {currency}
                            </div>
                          )}
                        </div>
                        {shareType === "equal" ? null : (
                          <FormField
                            control={form.control}
                            name={`participants.${i}.value`}
                            render={({ field }) =>
                              shareType === "percent" ? (
                                <div className="relative shrink-0">
                                  <Input
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    inputMode="decimal"
                                    className="num w-24 pr-6 text-right"
                                    disabled={!isIncluded}
                                    {...field}
                                    {...makeDistributeHandlers("percent", f.userId, field)}
                                  />
                                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                                    %
                                  </span>
                                </div>
                              ) : shareType === "shares" ? (
                                <div className="relative shrink-0">
                                  <Input
                                    type="number"
                                    step="1"
                                    min="0"
                                    inputMode="numeric"
                                    className="num w-24 pr-7 text-right"
                                    disabled={!isIncluded}
                                    {...field}
                                    onFocus={(e) => {
                                      const def = defaultValueByUserId.get(f.userId);
                                      if (def !== undefined && field.value === def) {
                                        field.onChange("");
                                        e.target.value = "";
                                      }
                                    }}
                                    onBlur={(e) => {
                                      field.onBlur();
                                      if (!e.target.value) {
                                        const def = defaultValueByUserId.get(f.userId) ?? "";
                                        field.onChange(def);
                                      }
                                    }}
                                  />
                                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                                    份
                                  </span>
                                </div>
                              ) : shareType === "adjustment" ? (
                                <div className="flex shrink-0 items-center gap-1">
                                  <span className="select-none text-sm text-muted-foreground">
                                    +
                                  </span>
                                  <Input
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    inputMode="decimal"
                                    className="num w-20 text-right"
                                    disabled={!isIncluded}
                                    {...field}
                                    onFocus={(e) => {
                                      if (field.value === "0") {
                                        field.onChange("");
                                        e.target.value = "";
                                      }
                                    }}
                                    onBlur={(e) => {
                                      field.onBlur();
                                      if (!e.target.value) field.onChange("0");
                                    }}
                                  />
                                </div>
                              ) : (
                                <Input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  inputMode="decimal"
                                  className="num w-24 shrink-0 text-right"
                                  disabled={!isIncluded}
                                  {...field}
                                  {...makeDistributeHandlers("exact", f.userId, field)}
                                />
                              )
                            }
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
                {/* Stats bar */}
                <div className="rounded-2xl bg-secondary/50 px-4 py-3">
                  {shareType === "equal" ? (
                    <div className="flex items-center justify-between">
                      <span className="num text-sm text-muted-foreground">
                        每人 {(computedSplits[0]?.amount ?? 0).toFixed(2)} {currency} · 共{" "}
                        {included.length} 人
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          if (!allIncluded) replace(fields.map((f) => ({ ...f, included: true })));
                        }}
                        className={cn(
                          "flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium transition-all",
                          allIncluded
                            ? "bg-primary/10 text-primary"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {allIncluded && <Check className="size-3" />}
                        全選
                      </button>
                    </div>
                  ) : shareType === "percent" ? (
                    <div
                      className={cn(
                        "num flex items-center gap-1.5 text-sm",
                        splitsBalanced ? "text-muted-foreground" : "text-rose-500",
                      )}
                    >
                      {inputSum.toFixed(2)}% / 100%
                      {!splitsBalanced && <> · 尚餘 {Math.max(0, 100 - inputSum).toFixed(2)}%</>}
                      {splitsBalanced ? (
                        <Check className="size-3.5 shrink-0" />
                      ) : (
                        <X className="size-3.5 shrink-0" />
                      )}
                    </div>
                  ) : shareType === "shares" ? (
                    <div
                      className={cn(
                        "num flex items-center gap-1.5 text-sm",
                        splitsBalanced ? "text-muted-foreground" : "text-rose-500",
                      )}
                    >
                      共 {inputSum.toFixed(0)} 份
                      {splitsBalanced ? (
                        <Check className="size-3.5 shrink-0" />
                      ) : (
                        <X className="size-3.5 shrink-0" />
                      )}
                    </div>
                  ) : shareType === "adjustment" ? (
                    <div
                      className={cn(
                        "num flex items-center gap-1.5 text-sm",
                        splitsBalanced ? "text-muted-foreground" : "text-rose-500",
                      )}
                    >
                      額外 {inputSum.toFixed(2)} {currency} · 每人{" "}
                      {(adjBases.values().next().value ?? 0).toFixed(2)} {currency}
                      {splitsBalanced ? (
                        <Check className="size-3.5 shrink-0" />
                      ) : (
                        <X className="size-3.5 shrink-0" />
                      )}
                    </div>
                  ) : (
                    <div
                      className={cn(
                        "num flex items-center gap-1.5 text-sm",
                        splitsBalanced ? "text-muted-foreground" : "text-rose-500",
                      )}
                    >
                      {inputSum.toFixed(2)} / {totalAmount.toFixed(2)} {currency}
                      {!splitsBalanced && totalAmount > 0 && (
                        <> · 尚餘 {Math.abs(totalAmount - inputSum).toFixed(2)}</>
                      )}
                      {splitsBalanced ? (
                        <Check className="size-3.5 shrink-0" />
                      ) : (
                        <X className="size-3.5 shrink-0" />
                      )}
                    </div>
                  )}
                </div>
                <FormMessage />
              </FormItem>
            )}
          />

          {form.formState.errors.root && (
            <p className="rounded-lg bg-destructive/10 px-4 py-2.5 text-sm text-destructive">
              {form.formState.errors.root.message}
            </p>
          )}

          {/* Actions */}
          {isEdit && recordedBy && (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">
                由 {recordedBy} {initial?.createdVia ? `${viaText(initial.createdVia)} ` : ""}
                {initial?.createdAt ? `於 ${stampLabel(initial.createdAt)} ` : ""}
                記錄
              </p>
              {lastEdit && (
                <Link
                  href={recordHistoryHref({
                    appBase,
                    groupId,
                    recordId: initial!.id,
                    from: pathname,
                  })}
                  className="-mx-2 flex items-center justify-between gap-2 rounded-lg px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-secondary"
                >
                  <span>
                    最後由 {lastEdit.by} {lastEdit.via ? `${viaText(lastEdit.via)} ` : ""}於{" "}
                    {stampLabel(lastEdit.at)} 修改
                  </span>
                  <ChevronRight className="size-3.5 shrink-0" />
                </Link>
              )}
            </div>
          )}
          <div className="flex gap-2 pt-1">
            <Button
              type="submit"
              disabled={form.formState.isSubmitting || !form.formState.isValid || receiptUploading}
              className="flex-1 rounded-lg"
            >
              {form.formState.isSubmitting ? "儲存中…" : "儲存"}
            </Button>
            {isEdit && (
              <Button
                type="button"
                variant="destructive"
                disabled={deletePending}
                className="rounded-lg"
                onClick={() => setDeleteConfirmOpen(true)}
              >
                刪除
              </Button>
            )}
          </div>
          {deleteError && (
            <p className="rounded-lg bg-destructive/10 px-4 py-2.5 text-sm text-destructive">
              {deleteError}
            </p>
          )}
        </form>

        <ConfirmDialog
          open={deleteConfirmOpen}
          onOpenChange={setDeleteConfirmOpen}
          title="確認刪除"
          description={
            recordedBySomeoneElse && recordedBy
              ? `這筆是 ${recordedBy} 記錄的，刪除後無法復原。`
              : "這筆支出將被永久刪除。"
          }
          confirmLabel="刪除"
          variant="destructive"
          loading={deletePending}
          onConfirm={handleDelete}
        />
      </Form>

      {/* Receipt lightbox */}
      <Dialog open={lightboxOpen} onOpenChange={setLightboxOpen}>
        <DialogContent className="flex max-w-[calc(100vw-2rem)] flex-col items-center gap-3 border-0 bg-black/90 p-4 shadow-none backdrop-blur-sm [&>button]:text-white [&>button]:opacity-80 [&>button]:hover:opacity-100">
          {receiptFileIds.length > 0 &&
            (() => {
              const safeIdx = Math.min(lightboxIndex, receiptFileIds.length - 1);
              return (
                <>
                  <DialogTitle className="sr-only">
                    收據大圖 {safeIdx + 1} / {receiptFileIds.length}
                  </DialogTitle>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={receiptUrls[receiptFileIds[safeIdx]]}
                    alt="收據大圖"
                    className="max-h-[80dvh] w-full rounded-2xl object-contain"
                  />
                  {receiptFileIds.length > 1 && (
                    <div className="flex items-center gap-4 text-white">
                      <button
                        type="button"
                        onClick={() =>
                          setLightboxIndex(
                            (i) =>
                              (Math.min(i, receiptFileIds.length - 1) - 1 + receiptFileIds.length) %
                              receiptFileIds.length,
                          )
                        }
                        className="rounded-lg p-1.5 hover:bg-white/10"
                        aria-label="上一張"
                      >
                        <ChevronLeft className="size-5" />
                      </button>
                      <span className="text-sm tabular-nums">
                        {safeIdx + 1} / {receiptFileIds.length}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setLightboxIndex(
                            (i) =>
                              (Math.min(i, receiptFileIds.length - 1) + 1) % receiptFileIds.length,
                          )
                        }
                        className="rounded-lg p-1.5 hover:bg-white/10"
                        aria-label="下一張"
                      >
                        <ChevronRight className="size-5" />
                      </button>
                    </div>
                  )}
                </>
              );
            })()}
          {receiptFileIds.length === 0 && <DialogTitle className="sr-only">收據大圖</DialogTitle>}
        </DialogContent>
      </Dialog>
    </>
  );
}
