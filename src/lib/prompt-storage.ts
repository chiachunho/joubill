"use client";

import type { PromptKind, PromptRecord } from "@/lib/onboarding-prompts";

/**
 * Where this device remembers its answers to the group page's cards. localStorage, because
 * the answer is about this device; sessionStorage for "a card was already shown this visit".
 * Storage can be missing or throw (private mode, a full quota): every read then means "never
 * asked" and every write is dropped, which at worst asks once more.
 */

const recordKey = (kind: PromptKind) => `jiuzhang:prompt:${kind}`;
const VISIT_KEY = "jiuzhang:prompt:visit";

export function readPromptRecord(kind: PromptKind): PromptRecord {
  try {
    const raw = localStorage.getItem(recordKey(kind));
    if (!raw) return null;
    const value = JSON.parse(raw) as PromptRecord;
    if (value && ("never" in value || typeof value.snoozedUntil === "number")) return value;
    return null;
  } catch {
    return null;
  }
}

export function writePromptRecord(kind: PromptKind, record: PromptRecord): void {
  try {
    if (record) localStorage.setItem(recordKey(kind), JSON.stringify(record));
    else localStorage.removeItem(recordKey(kind));
  } catch {
    // storage unavailable: the card may ask again next time
  }
}

export function readShownThisVisit(): PromptKind | null {
  try {
    const value = sessionStorage.getItem(VISIT_KEY);
    return value === "home-screen" || value === "push" ? value : null;
  } catch {
    return null;
  }
}

export function writeShownThisVisit(kind: PromptKind): void {
  try {
    sessionStorage.setItem(VISIT_KEY, kind);
  } catch {
    // ignore
  }
}
