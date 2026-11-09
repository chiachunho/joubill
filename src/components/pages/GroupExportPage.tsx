"use client";

import { use, useState } from "react";
import { Download, ExternalLink, Send } from "lucide-react";

import { ActionRow } from "@/components/mini/ActionRow";
import { BeancountExportSection } from "@/components/mini/BeancountExportSection";
import { BeancountSettingsSection } from "@/components/mini/BeancountSettingsSection";
import { NavRow } from "@/components/mini/NavRow";
import { TelegramGlyph } from "@/components/TelegramIcon";
import type { Platform } from "@/components/pages/platform";
import { saveResponseAsFile } from "@/lib/download";
import { useGetGroupChatQuery } from "@/store/api";

/**
 * 匯出: the one page behind the group settings row of the same name. The group's CSV on top, then
 * the personal Beancount export: its three accounts, then the range and the export itself.
 */
export function GroupExportPage({
  params,
  platform,
}: {
  params: Promise<{ id: string }>;
  platform: Platform;
}) {
  const { id } = use(params);

  const backHref = `${platform.basePath}/groups/${id}/settings`;
  platform.useBack(backHref);

  // A group with no Telegram chat has nowhere to post the CSV, so that row is replaced by the
  // ways that do work. While the answer loads, or if it fails, the row shows as before.
  const { data: chat } = useGetGroupChatQuery(id);
  const noChat = chat?.linked === false;

  const [exportPending, setExportPending] = useState<"download" | "send" | null>(null);
  const [exportMessage, setExportMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function exportCsv(mode: "download" | "send") {
    if (exportPending) return;
    setExportPending(mode);
    setExportMessage(null);
    try {
      if (mode === "send") {
        const res = await platform.rawRequest(`/api/groups/${id}/export/send`, { method: "POST" });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          setExportMessage({ ok: false, text: data.error ?? "匯出失敗，請再試一次" });
          return;
        }
        setExportMessage({ ok: true, text: "已傳送到群組" });
        return;
      }
      const res = await platform.rawRequest(`/api/groups/${id}/export?format=csv`);
      if (!res.ok) {
        setExportMessage({ ok: false, text: "匯出失敗，請再試一次" });
        return;
      }
      await saveResponseAsFile(res, "export.csv");
    } catch {
      setExportMessage({ ok: false, text: "匯出失敗，請再試一次" });
    } finally {
      setExportPending(null);
    }
  }

  return (
    <div className="space-y-6 py-4">
      <div className="px-4">
        <platform.BackLink href={backHref} />
        <h1 className="text-lg font-semibold">匯出</h1>
      </div>

      {/* CSV — one file of every record. The Web App can save it directly; Telegram's webview
          can't take an authenticated download, so both apps can also have the bot post the file
          in the group chat (the same file /export sends). */}
      <section className="px-4">
        <p className="sect mb-2.5">CSV</p>
        <div className="divide-y divide-border/40 overflow-hidden rounded-2xl bg-secondary/50">
          {platform.canDownloadExport && (
            <ActionRow
              icon={Download}
              onClick={() => exportCsv("download")}
              disabled={exportPending !== null}
            >
              {exportPending === "download" ? "匯出中…" : "下載 CSV"}
            </ActionRow>
          )}
          {noChat ? (
            <>
              <p className="px-4 pb-1 pt-3 text-xs leading-relaxed text-muted-foreground">
                {platform.canDownloadExport
                  ? "這個群組還沒綁定 Telegram 群組，所以不能傳到群組。"
                  : "這個群組還沒綁定 Telegram 群組，所以不能傳到群組；Mini App 也不能直接下載。"}
              </p>
              {!platform.canDownloadExport && platform.openInBrowser && (
                <ActionRow
                  icon={ExternalLink}
                  onClick={() => platform.openInBrowser?.(`/app/groups/${id}/settings/export`)}
                >
                  用瀏覽器開啟網頁版下載
                </ActionRow>
              )}
              <NavRow
                href={`${platform.basePath}/groups/${id}/settings/telegram`}
                icon={TelegramGlyph}
              >
                綁定 Telegram 群組
              </NavRow>
            </>
          ) : (
            <ActionRow
              icon={Send}
              onClick={() => exportCsv("send")}
              disabled={exportPending !== null}
            >
              {exportPending === "send" ? "傳送中…" : "匯出 CSV 到群組"}
            </ActionRow>
          )}
        </div>
        {exportMessage && (
          <p
            className={`mt-2 px-1 text-xs ${exportMessage.ok ? "text-muted-foreground" : "text-destructive"}`}
          >
            {exportMessage.text}
          </p>
        )}
      </section>

      {/* Beancount — a personal ledger export, so it stays apart from the group's CSV. */}
      <div className="space-y-3">
        <p className="sect px-4">Beancount 帳戶設定</p>
        <BeancountSettingsSection groupId={id} />
      </div>

      <BeancountExportSection groupId={id} platform={platform} />
    </div>
  );
}
