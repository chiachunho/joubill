import Link from "next/link";
import { GitFork, Star } from "lucide-react";

import { Logo } from "@/components/Logo";
import { TelegramGlyph } from "@/components/TelegramIcon";
import { Button } from "@/components/ui/button";
import {
  AUTHOR_NAME,
  AUTHOR_URL,
  REPO_ARCHITECTURE_URL,
  REPO_DEPLOYMENT_URL,
  REPO_FORK_URL,
  REPO_ISSUES_URL,
  REPO_NAME,
  REPO_OWNER,
  REPO_URL,
  formatStars,
} from "@/lib/github-repo";
import { BTN } from "@/lib/buttons";
import { todayIn } from "@/lib/day";
import { HELP_PATH, PRIVACY_PATH, TERMS_PATH } from "@/lib/help-url";
import { DEFAULT_TIME_ZONE } from "@/lib/timezone";
import { SUPPORTED_CURRENCIES } from "@/lib/zod";

import { GitHubMark } from "./GitHubMark";
import { LifeDemo } from "./LifeDemo";

export type LandingProps = {
  /** Telegram's "add to group" picker for the bot, or the help site when the bot's name is unknown. */
  addToGroupHref: string;
  /** The repository's star count; null hides the number. */
  stars: number | null;
};

const WEB_APP_PATH = "/app";

/**
 * The public landing page at `/`. It is both the product's front door and a portfolio piece,
 * so it leads with what sets 揪帳 apart (the record lives in the chat, free without limits,
 * dates-correct FX, anyone may correct with a trail) and gives the open-source repository its
 * own section. Statements about other tools stay general and dated, since their plans change.
 */
export function Landing({ addToGroupHref, stars }: LandingProps) {
  const external = addToGroupHref.startsWith("http");
  return (
    <div className="text-[17px] leading-relaxed">
      <div className="mx-auto max-w-6xl px-6">
        <nav className="flex items-center justify-between gap-4 py-5" aria-label="主選單">
          <Link href="/" className="flex items-center gap-2.5 text-xl font-bold">
            <Logo size={28} />
            揪帳
          </Link>
          <div className="flex items-center gap-6 text-sm">
            <a href="#why" className="hidden text-muted-foreground hover:text-foreground md:inline">
              為什麼選揪帳
            </a>
            <a
              href="#open-source"
              className="hidden text-muted-foreground hover:text-foreground md:inline"
            >
              開源
            </a>
            <Link
              href={HELP_PATH}
              className="hidden text-muted-foreground hover:text-foreground md:inline"
            >
              使用說明
            </Link>
            <Button asChild variant="outline" size="sm" className="hidden sm:inline-flex">
              <Link href={WEB_APP_PATH}>登入網頁版</Link>
            </Button>
            <StarButton stars={stars} size="sm" />
          </div>
        </nav>

        <header className="grid items-start gap-14 pb-24 pt-10 lg:grid-cols-[1fr_440px]">
          <div>
            <h1 className="text-balance text-4xl font-bold leading-tight sm:text-5xl lg:text-6xl">
              就這樣，
              <br />
              記帳分帳就是這麼簡單
            </h1>
            <p className="mt-6 max-w-[27em] text-lg text-muted-foreground">
              每一筆帳都是聊天室裡的一則訊息。誰付的、怎麼分、後來誰改過，全群組一眼就看到。不用每個人下載
              App，也沒有每天能記幾筆的限制。
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <Button asChild size="lg" className="h-11 px-6 text-base">
                <a href={addToGroupHref} {...(external && { target: "_blank", rel: "noreferrer" })}>
                  <TelegramGlyph />
                  加到 Telegram 群組
                </a>
              </Button>
              <Button asChild size="lg" variant="outline" className="h-11 px-6 text-base">
                <Link href={WEB_APP_PATH}>開啟網頁版</Link>
              </Button>
            </div>
            <p className="mt-5 text-sm text-muted-foreground">
              <GitHubMark className="mr-1.5 inline size-4 align-[-3px]" />
              揪帳是 MIT 授權的開源專案，
              <a href={REPO_URL} className="text-foreground underline underline-offset-4">
                原始碼都在 GitHub 上
              </a>
              ，喜歡的話歡迎給個 Star。
            </p>
            <dl className="mt-10 flex flex-wrap gap-7 text-sm text-muted-foreground">
              <Fact value="0 元">不限筆數，沒有廣告</Fact>
              <Fact value={`${SUPPORTED_CURRENCIES.length} 種幣別`}>每筆照當天匯率</Fact>
              <Fact value="每次修改">都留下紀錄</Fact>
            </dl>
          </div>
          <div className="w-full max-w-[460px] lg:sticky lg:top-6">
            <LifeDemo />
          </div>
        </header>
      </div>

      <Section id="why">
        <div className="grid gap-10 lg:grid-cols-[320px_1fr] lg:gap-16">
          <div className="lg:sticky lg:top-8 lg:self-start">
            <h2 className="text-3xl font-bold sm:text-4xl">為什麼選揪帳</h2>
            <p className="mt-4 text-muted-foreground">
              分帳 App 很多。揪帳的差別在於它就住在你們的群組裡，而且該免費的都免費。
            </p>
          </div>
          <div className="divide-y">
            <Reason title="不用說服朋友裝 App">
              把揪帳加進 Telegram 群組，記帳、看餘額、結算都在聊天室裡。想看細節，點卡片上的「
              {BTN.adjust}」→「{BTN.appEdit}」就在 Telegram 裡打開，不用下載也不用註冊。
            </Reason>
            <Reason
              title="免費，記再多筆也一樣"
              proof={
                <ul className="flex flex-wrap gap-2.5 text-sm">
                  {["不限筆數", "不限群組", "多幣別", "收據照片", "CSV 匯出"].map((t) => (
                    <li key={t} className="rounded-lg border border-primary px-3 py-1 text-primary">
                      {t}
                    </li>
                  ))}
                </ul>
              }
            >
              沒有每日筆數上限，沒有看完廣告才能存檔，多幣別、收據照片、匯出也都不用升級。一趟旅行記一百筆，跟記一筆一樣。
            </Reason>
            <Reason
              title="出國記帳，匯率不會亂跳"
              proof={
                <table className="num w-full max-w-lg overflow-hidden rounded-2xl bg-card text-sm">
                  <tbody className="divide-y">
                    <RateRow day="11/02" item="拉麵 4,800 JPY" rate="當天匯率" result="1,027 TWD" />
                    <RateRow day="11/03" item="車票 2,300 JPY" rate="當天匯率" result="491 TWD" />
                    <RateRow
                      day="11/04"
                      item="伴手禮 60 USD"
                      rate="群組匯率 32"
                      result="1,920 TWD"
                    />
                  </tbody>
                </table>
              }
            >
              日圓、韓元、美金都能直接記，每筆照<b className="text-foreground">消費當天</b>
              的匯率換算，記好的金額不會因為匯率明天變動而改變。大家講好用固定匯率？在群組設定裡設一個，就整趟都用它。
            </Reason>
            <Reason
              title="誰都能改，改了大家都知道"
              proof={
                <ul className="num max-w-lg text-sm">
                  <HistoryRow text="小明 記錄「燒肉」300 TWD" time="11/02 20:41" />
                  <HistoryRow text="小美 把金額改成 3,000 TWD" time="11/02 20:44" />
                </ul>
              }
            >
              有人把 3,000 打成
              300，旁邊的人當場就能修正，不用等他回訊息。每一次新增、修改、刪除都會記下是誰、什麼時候、改了什麼，群組裡的卡片也會跟著更新。
            </Reason>
            <Reason
              title="沒有 Telegram 的朋友也算得進來"
              proof={
                <p className="flex flex-wrap items-center gap-3 text-sm">
                  <span className="rounded-lg border border-dashed border-muted-foreground px-3 py-1 text-muted-foreground">
                    阿姨（暫代）
                  </span>
                  <span aria-hidden="true">→</span>
                  <span className="rounded-lg bg-primary px-3 py-1 text-primary-foreground">
                    阿姨 已加入
                  </span>
                </p>
              }
            >
              先替他建一個名字記帳。他之後登入網頁版、點邀請連結加入，認領那個名字，之前的帳就全部接上。
            </Reason>
          </div>
        </div>
      </Section>

      <Section id="open-source">
        <div className="grid items-start gap-10 lg:grid-cols-[1fr_440px] lg:gap-16">
          <div>
            <h2 className="text-3xl font-bold sm:text-4xl">開源，程式碼都在 GitHub 上</h2>
            <p className="mt-4 max-w-[34em] text-muted-foreground">
              揪帳從 bot、Mini App、網頁版到 API 都是同一個 Next.js 專案，以 MIT
              授權公開。想看一個記帳服務怎麼處理多幣別、權限和修改紀錄，可以直接讀程式碼；想自己架一個，照部署說明就行。
            </p>
            <dl className="mt-7 grid max-w-[36em] gap-3.5 text-base">
              <Stack term="前端">
                Next.js 15 App Router、React、Tailwind、shadcn/ui、RTK Query
              </Stack>
              <Stack term="Bot">grammY，Telegram Mini App 與 webhook</Stack>
              <Stack term="資料">Drizzle ORM、Neon Postgres，資料遷移在部署時自動執行</Stack>
              <Stack term="登入">Auth.js，Telegram、Google、GitHub、LINE 綁同一個帳號</Stack>
              <Stack term="AI">MCP 伺服器，支援 OAuth 與個人權杖，可限制群組與唯讀</Stack>
              <Stack term="測試">
                Vitest 單元與元件測試；每個 PR 在自己的預覽資料庫上跑 Playwright E2E
              </Stack>
            </dl>
          </div>
          <aside className="grid gap-4 rounded-2xl border bg-card p-6" aria-label="GitHub 專案">
            <p className="flex items-center gap-2.5 break-all text-base font-bold">
              <GitHubMark />
              <span className="font-normal text-muted-foreground">{REPO_OWNER} /</span>
              {REPO_NAME}
            </p>
            <p className="text-sm text-muted-foreground">
              Telegram 群組分帳機器人，附 Mini App、網頁版與 MCP 伺服器。
            </p>
            <ul className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              {["TypeScript", "MIT", "Next.js", "Telegram Bot"].map((t) => (
                <li key={t} className="rounded-lg bg-secondary px-2.5 py-1">
                  {t}
                </li>
              ))}
            </ul>
            <div className="grid grid-cols-2 gap-2.5">
              <StarButton stars={stars} />
              <Button asChild variant="outline">
                <a href={REPO_FORK_URL}>
                  <GitFork />
                  Fork
                </a>
              </Button>
            </div>
            <ul className="grid gap-1.5 border-t pt-4 text-sm">
              <li>
                <a href={REPO_ARCHITECTURE_URL} className="underline-offset-4 hover:underline">
                  架構設計文件
                </a>
              </li>
              <li>
                <a href={REPO_DEPLOYMENT_URL} className="underline-offset-4 hover:underline">
                  自己架一個：部署說明
                </a>
              </li>
              <li>
                <a href={REPO_ISSUES_URL} className="underline-offset-4 hover:underline">
                  回報問題或提出建議
                </a>
              </li>
            </ul>
          </aside>
        </div>
      </Section>

      <Section id="switch">
        <h2 className="text-3xl font-bold sm:text-4xl">從其他工具換過來</h2>
        <p className="mt-4 max-w-[34em] text-muted-foreground">
          每種工具都有它擅長的情境。如果你遇過下面這些狀況，揪帳可能更適合你們這群人。
        </p>
        <div className="mt-10 overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-base">
            <thead>
              <tr className="border-b border-foreground text-left text-sm text-muted-foreground">
                <th className="pb-3 pr-5 font-medium">你現在用</th>
                <th className="pb-3 pr-5 font-medium">可能遇過的狀況</th>
                <th className="pb-3 font-medium">在揪帳</th>
              </tr>
            </thead>
            <tbody className="divide-y align-top">
              <SwitchRow
                from="Splitwise"
                pain="免費版每天能記的筆數有限，還會跳廣告；外幣換算等功能要付費版。"
                here={`不限筆數、沒有廣告，${SUPPORTED_CURRENCIES.length} 種幣別依當天匯率換算，全部免費。`}
              />
              <SwitchRow
                from="Tricount、Settle Up 等分帳 App"
                pain="每個人都要先裝 App、加入帳本，總有一兩個人一直沒裝。"
                here="帳記在大家本來就在的群組裡，打開聊天室就看得到。"
              />
              <SwitchRow
                from="其他群組記帳機器人"
                pain="要記住固定格式，打錯就得重來；想改誰分、改幣別，又得再打一串指令。"
                here="金額怎麼打都看得懂，分法用按鈕調整；任何成員都能修正，而且每次修改都有紀錄。"
              />
              <SwitchRow
                from="Excel、記事本"
                pain="一個人負責整理，最後還要自己算誰該轉給誰。"
                here="每個人自己記，/settle 直接算出最少的轉帳次數。"
              />
            </tbody>
          </table>
        </div>
        <p className="mt-4 max-w-[48em] text-sm text-muted-foreground">
          其他工具的方案和限制會變動，以上依 2026 年 11 月公開資訊整理，實際以各服務官方說明為準。
        </p>
      </Section>

      <Section id="start">
        <h2 className="text-3xl font-bold sm:text-4xl">三分鐘開始第一筆</h2>
        <ol className="mt-10 grid gap-10 md:grid-cols-3">
          <Step n={1} title="把揪帳加進群組">
            在群組裡輸入 /start，每個人點一下「{BTN.openApp}」就會加入分帳。
          </Step>
          <Step n={2} title="誰付錢誰記一筆">
            打「/add 金額 說明」，要改誰分、份數或幣別，點卡片上的「{BTN.adjust}」。
          </Step>
          <Step n={3} title="出遊結束時結算">
            打 /settle，揪帳算出誰該轉給誰、轉多少，次數最少。
          </Step>
        </ol>
        <p className="mt-14 max-w-[46em] text-muted-foreground">
          另外還有：<b className="font-medium text-foreground">收據照片</b>跟帳一起存、
          <b className="font-medium text-foreground">CSV 和 Beancount 匯出</b>到你自己的帳本、
          <b className="font-medium text-foreground">加到手機主畫面</b>收推播通知，以及連結{" "}
          <b className="font-medium text-foreground">Claude 等 AI 助理</b>幫你記帳。
        </p>
      </Section>

      <div className="mx-auto max-w-6xl px-6">
        <div className="mb-16 grid items-center gap-8 rounded-2xl bg-primary p-8 text-primary-foreground sm:p-14 lg:grid-cols-[1fr_auto]">
          <div>
            <h2 className="text-3xl font-bold sm:text-4xl">
              下次聚餐，
              <br />
              帳就記在群組裡。
            </h2>
            <p className="mt-2.5 opacity-90">免費使用，加進群組就能記第一筆。</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button
              asChild
              size="lg"
              className="h-11 bg-background px-6 text-base text-foreground hover:bg-background/90"
            >
              <a href={addToGroupHref} {...(external && { target: "_blank", rel: "noreferrer" })}>
                <TelegramGlyph />
                加到 Telegram 群組
              </a>
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="h-11 border-primary-foreground/60 bg-transparent px-6 text-base text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
            >
              <a href={REPO_URL}>
                <Star />在 GitHub 給個 Star
              </a>
            </Button>
          </div>
        </div>
        <footer className="flex flex-wrap justify-between gap-4 border-t pb-12 pt-7 text-sm text-muted-foreground">
          <p>
            © {todayIn(DEFAULT_TIME_ZONE).slice(0, 4)} 揪帳，由{" "}
            <a href={AUTHOR_URL} className="text-foreground underline-offset-4 hover:underline">
              {AUTHOR_NAME}
            </a>{" "}
            設計與開發，MIT 授權
          </p>
          <nav className="flex flex-wrap gap-5" aria-label="頁尾">
            <Link href={HELP_PATH} className="hover:text-foreground">
              使用說明
            </Link>
            <Link href={PRIVACY_PATH} className="hover:text-foreground">
              隱私權政策
            </Link>
            <Link href={TERMS_PATH} className="hover:text-foreground">
              服務條款
            </Link>
            <Link href={WEB_APP_PATH} className="hover:text-foreground">
              網頁版
            </Link>
            <a href={REPO_URL} className="hover:text-foreground">
              GitHub
            </a>
          </nav>
        </footer>
      </div>
    </div>
  );
}

function StarButton({ stars, size }: { stars: number | null; size?: "sm" }) {
  return (
    <Button
      asChild
      size={size}
      className="bg-foreground text-background hover:bg-foreground/85"
      aria-label={stars === null ? "在 GitHub 上給 Star" : `在 GitHub 上給 Star，目前 ${stars} 顆`}
    >
      <a href={REPO_URL}>
        <GitHubMark />
        <Star />
        Star
        {stars !== null && <span className="num opacity-70">{formatStars(stars)}</span>}
      </a>
    </Button>
  );
}

function Section({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <section id={id} className="border-t py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-6">{children}</div>
    </section>
  );
}

function Fact({ value, children }: { value: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="num text-2xl font-bold leading-snug text-foreground">{value}</dt>
      <dd className="m-0">{children}</dd>
    </div>
  );
}

function Reason({
  title,
  children,
  proof,
}: {
  title: string;
  children: React.ReactNode;
  proof?: React.ReactNode;
}) {
  return (
    <article className="grid gap-3 py-12 first:pt-0 last:pb-0">
      <h3 className="text-2xl font-bold">{title}</h3>
      <p className="max-w-[36em] text-muted-foreground">{children}</p>
      {proof && <div className="mt-2">{proof}</div>}
    </article>
  );
}

function RateRow({
  day,
  item,
  rate,
  result,
}: {
  day: string;
  item: string;
  rate: string;
  result: string;
}) {
  return (
    <tr>
      <td className="w-16 py-2.5 pl-4 text-muted-foreground">{day}</td>
      <td className="py-2.5">{item}</td>
      <td className="py-2.5 pr-4 text-right text-muted-foreground">
        {rate} <b className="font-medium text-foreground">{result}</b>
      </td>
    </tr>
  );
}

function HistoryRow({ text, time }: { text: string; time: string }) {
  return (
    <li className="flex justify-between gap-4 border-b border-dashed py-2.5">
      <span>{text}</span>
      <span className="text-muted-foreground">{time}</span>
    </li>
  );
}

function Stack({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[5.5rem_1fr] gap-4">
      <dt className="text-muted-foreground">{term}</dt>
      <dd className="m-0">{children}</dd>
    </div>
  );
}

function SwitchRow({ from, pain, here }: { from: string; pain: string; here: string }) {
  return (
    <tr>
      <td className="w-1/5 py-5 pr-5 font-bold">{from}</td>
      <td className="w-2/5 py-5 pr-5 text-muted-foreground">{pain}</td>
      <td className="py-5">{here}</td>
    </tr>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="grid content-start gap-2">
      <span className="flex size-8 items-center justify-center rounded-full bg-foreground text-sm font-bold text-background">
        {n}
      </span>
      <h3 className="text-xl font-bold">{title}</h3>
      <p className="text-base text-muted-foreground">{children}</p>
    </li>
  );
}
