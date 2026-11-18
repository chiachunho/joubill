"use client";

import * as React from "react";

import { Textarea } from "@/components/ui/textarea";
import { NOTE_MAX } from "@/lib/zod";
import { cn } from "@/lib/utils";

/** The count shows only from here on, so it doesn't sit under every short note. */
export const NOTE_COUNT_FROM = 900;

/**
 * 備註 is folded away behind a link in another field's label row (說明 on an expense, 日期 on
 * a settlement), so a form whose records rarely carry one doesn't spend a whole field on it.
 * The two forms share the link and the box here so they can't drift.
 */

/** Open from the start when the record already has a note: a hidden note reads as no note. */
export function useNoteOpen(initialNote: string | null | undefined) {
  return React.useState(() => !!initialNote);
}

/**
 * The link in the label row. Folding keeps what was typed (it is still saved), so a folded
 * box with text in it says 顯示備註 rather than offering to add one.
 */
export function NoteToggle({
  open,
  hasText,
  onToggle,
}: {
  open: boolean;
  hasText: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className={cn(
        "-my-2 rounded-lg px-1 py-2 text-xs font-medium",
        open ? "text-muted-foreground" : "text-primary",
      )}
    >
      {open ? "收起" : hasText ? "顯示備註" : "＋ 備註"}
    </button>
  );
}

/** The box itself; focuses when opened by the link, not when the form loads with it open. */
export function NoteBox({
  value,
  onChange,
  onBlur,
  name,
  placeholder,
  autoFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  name?: string;
  placeholder: string;
  autoFocus: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Textarea
        aria-label="備註"
        name={name}
        rows={2}
        maxLength={NOTE_MAX}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        autoFocus={autoFocus}
      />
      {value.length >= NOTE_COUNT_FROM && (
        <span className="num self-end text-xs text-muted-foreground">
          {value.length} / {NOTE_MAX}
        </span>
      )}
    </div>
  );
}
