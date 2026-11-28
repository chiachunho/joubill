"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ImagePlus, Loader2, X } from "lucide-react";

import { useAuthMode } from "@/components/AuthProvider";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { MAX_RECEIPTS } from "@/lib/receipt-limits";
import { tmaRawFetch } from "@/lib/tma-fetch";
import { webRawFetch } from "@/lib/web-fetch";

/**
 * The 收據照片 field, shared by the expense form and the refund form (issue #178): up to
 * five photos uploaded through `/api/tg-upload` as they are picked, saved with the rest of
 * the form. Two copies of this would drift without an error (the cap, the upload route,
 * the "saved only on 儲存" hint), which is the sharing rule's test.
 */

export type ReceiptPhotosState = ReturnType<typeof useReceiptPhotos>;

/** The field's state, held by the form so it can send `fileIds` and wait on `uploading`. */
export function useReceiptPhotos(
  initial?: { receiptFileIds?: string[]; receiptUrls?: Record<string, string> } | null,
) {
  const [fileIds, setFileIds] = useState<string[]>(initial?.receiptFileIds ?? []);
  const [urls, setUrls] = useState<Record<string, string>>(initial?.receiptUrls ?? {});
  const [uploading, setUploading] = useState(false);
  return { fileIds, setFileIds, urls, setUrls, uploading, setUploading };
}

export function ReceiptPhotos({
  state,
  initialFileIds,
  focus,
  recordLabel,
}: {
  state: ReceiptPhotosState;
  /** The saved photos when editing, so a change can say it isn't saved yet; null when new. */
  initialFileIds: string[] | null;
  /** Opened to add photos (`?focus=receipts`): scroll here. */
  focus?: boolean;
  /** 這筆支出 / 這筆退稅, for the "saved with 儲存" hint. */
  recordLabel: string;
}) {
  const mode = useAuthMode();
  const { fileIds, setFileIds, urls, setUrls, uploading, setUploading } = state;
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Set<string>>(() => new Set(fileIds));
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sectionRef = useRef<HTMLDivElement>(null);

  // A link from a linked application (issue #163) opens the form to add photos: start there.
  // Optional call, since jsdom has no scrollIntoView.
  useEffect(() => {
    if (focus) sectionRef.current?.scrollIntoView?.({ block: "center" });
  }, [focus]);

  // Photos are saved with the rest of the form, so an edit that changed them says so before
  // the person leaves thinking they're already attached.
  const changed =
    initialFileIds !== null &&
    (fileIds.length !== initialFileIds.length || fileIds.some((id, i) => id !== initialFileIds[i]));

  async function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    const remaining = MAX_RECEIPTS - fileIds.length;
    const toUpload = files.slice(0, remaining);
    const skipped = files.length - toUpload.length;
    setError(null);
    setUploading(true);
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
      // Cap in the updater in case `remaining` was computed from stale closure state.
      if (succeeded.length > 0) {
        setUrls((prev) => ({
          ...prev,
          ...Object.fromEntries(succeeded.map((s) => [s.fileId, s.url])),
        }));
        setFileIds((prev) => [...prev, ...succeeded.map((s) => s.fileId)].slice(0, MAX_RECEIPTS));
      }
      const problems = [
        skipped > 0 ? `每筆最多 ${MAX_RECEIPTS} 張，已略過 ${skipped} 張` : null,
        failedCount > 0 ? `${failedCount} 張照片上傳失敗` : null,
      ].filter(Boolean);
      if (problems.length > 0) setError(`${problems.join("；")}。`);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  const markLoaded = (fileId: string) => setLoaded((prev) => new Set([...prev, fileId]));

  return (
    <div ref={sectionRef} className="flex flex-col gap-1.5">
      <Label as="span">收據照片</Label>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={handleChange}
      />
      {fileIds.length > 0 ? (
        <div className="grid grid-cols-3 gap-1.5">
          {fileIds.map((fileId, i) => (
            <div
              key={fileId}
              className="relative aspect-square overflow-hidden rounded-lg bg-secondary/50"
            >
              {!loaded.has(fileId) && <Skeleton className="absolute inset-0 rounded-none" />}
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
                  src={urls[fileId]}
                  alt={`收據 ${i + 1}`}
                  className="h-full w-full object-cover"
                  onLoad={() => markLoaded(fileId)}
                  onError={() => markLoaded(fileId)}
                />
              </button>
              <button
                type="button"
                onClick={() => setFileIds((prev) => prev.filter((_, j) => j !== i))}
                className="absolute top-1 right-1 rounded-full bg-black/50 p-1 text-white backdrop-blur-xs"
                aria-label="移除此收據"
              >
                <X className="size-3" />
              </button>
            </div>
          ))}
          {fileIds.length < MAX_RECEIPTS && (
            <button
              type="button"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
              className="flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-input bg-secondary/30 text-muted-foreground hover:bg-secondary/60 disabled:opacity-50"
            >
              {uploading ? (
                <Loader2 className="size-5 animate-spin" />
              ) : (
                <>
                  <ImagePlus className="size-5" />
                  <span className="text-xs">
                    {fileIds.length}/{MAX_RECEIPTS}
                  </span>
                </>
              )}
            </button>
          )}
        </div>
      ) : (
        <button
          type="button"
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
          className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-input bg-secondary/30 py-4 text-sm text-muted-foreground hover:bg-secondary/60 disabled:opacity-50"
        >
          {uploading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <ImagePlus className="size-4" />
          )}
          {uploading ? "上傳中…" : "附上收據照片"}
        </button>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {changed && !uploading && (
        <p className="text-sm text-muted-foreground">
          收據照片按下「儲存」後才會更新到{recordLabel}。
        </p>
      )}

      <Dialog open={lightboxOpen} onOpenChange={setLightboxOpen}>
        <DialogContent className="flex max-w-[calc(100vw-2rem)] flex-col items-center gap-3 border-0 bg-black/90 p-4 shadow-none backdrop-blur-xs [&>button]:text-white [&>button]:opacity-80 hover:[&>button]:opacity-100">
          {fileIds.length > 0 &&
            (() => {
              const safeIdx = Math.min(lightboxIndex, fileIds.length - 1);
              return (
                <>
                  <DialogTitle className="sr-only">
                    收據大圖 {safeIdx + 1} / {fileIds.length}
                  </DialogTitle>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={urls[fileIds[safeIdx]]}
                    alt="收據大圖"
                    className="max-h-[80dvh] w-full rounded-2xl object-contain"
                  />
                  {fileIds.length > 1 && (
                    <div className="flex items-center gap-4 text-white">
                      <button
                        type="button"
                        onClick={() =>
                          setLightboxIndex(
                            (i) =>
                              (Math.min(i, fileIds.length - 1) - 1 + fileIds.length) %
                              fileIds.length,
                          )
                        }
                        className="rounded-lg p-1.5 hover:bg-white/10"
                        aria-label="上一張"
                      >
                        <ChevronLeft className="size-5" />
                      </button>
                      <span className="text-sm tabular-nums">
                        {safeIdx + 1} / {fileIds.length}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setLightboxIndex(
                            (i) => (Math.min(i, fileIds.length - 1) + 1) % fileIds.length,
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
          {fileIds.length === 0 && <DialogTitle className="sr-only">收據大圖</DialogTitle>}
        </DialogContent>
      </Dialog>
    </div>
  );
}
