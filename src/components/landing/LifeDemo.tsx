"use client";

import { useRef, useState, type KeyboardEvent } from "react";

import { BTN } from "@/lib/buttons";
import { cn } from "@/lib/utils";

/**
 * The landing page's hero: one expense card going through its whole life in a group chat,
 * recorded → corrected by someone else → deleted. It is a picture of what the bot really does
 * (one message per record, edited in place, a tombstone on delete; see "Group messages for
 * records" in CLAUDE.md), so the button labels come from `BTN` and the tombstone keeps the
 * real `X 記錄 · Y 刪除` attribution.
 */

const PEOPLE = ["小明", "阿華", "小美", "大雄"];

type Stage = {
  tab: string;
  amount: string | null; // null = deleted
  share: string;
  time: string;
  edited: boolean;
  reply: { who: string; text: string } | null;
  caption: [string, string];
};

export const STAGES: Stage[] = [
  {
    tab: "記下來",
    amount: "300",
    share: "75",
    time: "20:41",
    edited: false,
    reply: null,
    caption: ["記下來。", "小明打一行，群組裡馬上多一張卡片，四個人各分多少一目了然。"],
  },
  {
    tab: "發現記錯",
    amount: "3,000",
    share: "750",
    time: "20:44",
    edited: true,
    reply: { who: "小美", text: "是 3,000 吧，我幫你改了" },
    caption: ["發現記錯。", "小美在 App 裡改成 3,000，改的是同一張卡片，不會再洗一則新訊息。"],
  },
  {
    tab: "刪掉",
    amount: null,
    share: "",
    time: "20:52",
    edited: false,
    reply: { who: "阿華", text: "這餐我請客，刪掉了" },
    caption: ["刪掉。", "卡片不會消失，而是留下誰記的、誰刪的。誰都能改，但改了大家都知道。"],
  },
];

export function LifeDemo() {
  const [index, setIndex] = useState(0);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const stage = STAGES[index];

  function onKeyDown(e: KeyboardEvent, i: number) {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (i + step + STAGES.length) % STAGES.length;
    setIndex(next);
    tabs.current[next]?.focus();
  }

  return (
    <div>
      <div
        className="overflow-hidden rounded-2xl border bg-secondary"
        role="tabpanel"
        id="life-demo-panel"
        aria-labelledby={`life-demo-tab-${index}`}
      >
        <div className="flex items-center gap-3 border-b bg-card px-4 py-3">
          <span className="flex size-9 items-center justify-center rounded-full bg-[hsl(var(--brand-gold))] font-bold">
            京
          </span>
          <div className="leading-tight">
            <p className="text-sm font-bold">京都五日遊</p>
            <p className="text-xs text-muted-foreground">4 位成員</p>
          </div>
        </div>

        <div className="flex min-h-[23rem] flex-col gap-2.5 px-3.5 py-4 text-sm leading-relaxed">
          <Bubble mine time="20:41">
            <span className="text-primary">/add</span> 300 燒肉
          </Bubble>

          <div className="flex w-[86%] flex-col gap-1" key={index} data-testid="life-demo-card">
            {stage.amount === null ? (
              <Bubble time={stage.time}>
                🗑 <s className="text-muted-foreground">燒肉　3,000 TWD</s>
                <span className="block text-xs text-muted-foreground">小明 記錄 · 阿華 刪除</span>
              </Bubble>
            ) : (
              <>
                <Bubble time={stage.edited ? `已編輯 ${stage.time}` : stage.time} wide>
                  <span className="block text-xs font-bold text-primary">揪帳</span>
                  <b>燒肉</b>　<span className="text-primary">小明</span> 付{" "}
                  <b className="num">{stage.amount} TWD</b>
                  {PEOPLE.map((p) => (
                    <span key={p} className="block">
                      ・<span className="text-primary">{p}</span>{" "}
                      <span className="num">{stage.share}</span>
                    </span>
                  ))}
                </Bubble>
                <div className="grid grid-cols-2 gap-1 text-center text-xs">
                  <KeyButton>{BTN.adjust}</KeyButton>
                  <KeyButton>{BTN.receipt}</KeyButton>
                  <KeyButton>{BTN.appEdit}</KeyButton>
                  <KeyButton danger>{BTN.delete}</KeyButton>
                </div>
              </>
            )}
          </div>

          {stage.reply && (
            <Bubble time={stage.time}>
              <span className="block text-xs font-bold text-muted-foreground">
                {stage.reply.who}
              </span>
              {stage.reply.text}
            </Bubble>
          )}
        </div>
      </div>

      <div
        className="mt-4 grid grid-cols-3 gap-1 rounded-lg border bg-card p-0.5"
        role="tablist"
        aria-label="記帳訊息的狀態"
      >
        {STAGES.map((s, i) => (
          <button
            key={s.tab}
            ref={(el) => {
              tabs.current[i] = el;
            }}
            id={`life-demo-tab-${i}`}
            type="button"
            role="tab"
            aria-selected={i === index}
            aria-controls="life-demo-panel"
            tabIndex={i === index ? 0 : -1}
            onClick={() => setIndex(i)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              "rounded-md px-2 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40",
              i === index
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {s.tab}
          </button>
        ))}
      </div>
      <p className="mt-3 min-h-[3.5em] text-sm text-muted-foreground" aria-live="polite">
        <b className="text-foreground">{stage.caption[0]}</b>
        {stage.caption[1]}
      </p>
    </div>
  );
}

function Bubble({
  children,
  time,
  mine = false,
  wide = false,
}: {
  children: React.ReactNode;
  time: string;
  mine?: boolean;
  wide?: boolean;
}) {
  return (
    <div
      className={cn(
        "max-w-[86%] rounded-2xl px-3 py-2",
        mine ? "self-end rounded-br-md bg-primary/15" : "self-start rounded-bl-md bg-card",
        wide && "max-w-full",
      )}
    >
      {children}
      <span className="mt-0.5 block text-right text-[11px] text-muted-foreground">{time}</span>
    </div>
  );
}

function KeyButton({ children, danger = false }: { children: string; danger?: boolean }) {
  return (
    <span
      className={cn("rounded-md bg-foreground/[.07] px-1 py-1.5", danger && "text-destructive")}
    >
      {children}
    </span>
  );
}
