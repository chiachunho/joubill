/**
 * Every page of the help site (`src/app/help/<slug>/page.mdx`), in sidebar order. One list feeds
 * the sidebar, the sitemap and each page's `<title>` / description (`helpMetadata`), so a page
 * can't show up in one and be missing from another. `help-pages.test.ts` fails when a
 * `page.mdx` has no entry here, or an entry has no page.
 */
export type HelpPage = {
  slug: string;
  /** Sidebar label, and the page's `<title>`. */
  label: string;
  /** The snippet a search engine shows under the title (about 70–80 characters). */
  description: string;
};

export type HelpGroup = { title: string; pages: HelpPage[] };

export const HELP_GROUPS: HelpGroup[] = [
  {
    title: "開始使用",
    pages: [
      {
        slug: "getting-started",
        label: "快速入門",
        description:
          "揪帳是 Telegram 裡的分帳機器人與網頁版。三步驟建立帳本、記第一筆帳、看誰欠誰。",
      },
      {
        slug: "account",
        label: "登入與帳號",
        description:
          "用 Telegram、Google、GitHub 或 LINE 登入揪帳，連結多種登入方式、合併帳號與個人設定。",
      },
    ],
  },
  {
    title: "記帳與還款",
    pages: [
      {
        slug: "adding-expenses",
        label: "記帳",
        description:
          "用 /add 一行指令或 Mini App 表單記帳：誰付、誰分、每人份數、收據照片與多人代墊。",
      },
      {
        slug: "settlement",
        label: "還款",
        description: "怎麼還、還多少最省事：揪帳算出最少轉帳次數，還款也會記成一筆紀錄。",
      },
      {
        slug: "multi-currency",
        label: "多幣別",
        description: "旅行常用的外幣記帳：以當天匯率換算、自訂群組匯率、單筆鎖定匯率與預設幣別。",
      },
    ],
  },
  {
    title: "看帳",
    pages: [
      {
        slug: "balances",
        label: "查看帳務",
        description:
          "用 /balance 與 /list 查看每個人的淨餘額與帳目清單，Mini App 與網頁版也看得到。",
      },
      {
        slug: "stats",
        label: "統計",
        description: "按月份、付款人與期間檢視個人與群組的花費統計與淨額趨勢。",
      },
      {
        slug: "export",
        label: "匯出",
        description: "把帳匯出成 CSV 或 Beancount，給試算表或記帳軟體使用。",
      },
    ],
  },
  {
    title: "群組",
    pages: [
      {
        slug: "members",
        label: "成員",
        description: "把朋友加進帳本：群組成員如何自動加入、邀請連結、佔位成員與認領。",
      },
      {
        slug: "group-settings",
        label: "群組設定",
        description: "群組名稱、預設幣別、時區、匯率、記帳通知位置與刪除群組。",
      },
    ],
  },
  {
    title: "更多",
    pages: [
      {
        slug: "add-to-home-screen",
        label: "加到主畫面與通知",
        description: "把揪帳網頁版加到手機主畫面，像 App 一樣打開，並開啟新帳目的推播通知。",
      },
      {
        slug: "mcp",
        label: "連結 AI 工具（MCP）",
        description:
          "用 MCP 把 Claude、ChatGPT、Cursor 或 n8n 連到揪帳，讓 AI 助理幫你記帳與查帳。",
      },
    ],
  },
  {
    title: "說明",
    pages: [
      {
        slug: "troubleshooting",
        label: "常見問題",
        description: "揪帳常見問題與排解：機器人沒反應、成員沒進帳本、登入失敗與聯絡方式。",
      },
      {
        slug: "privacy",
        label: "隱私權政策",
        description:
          "揪帳會蒐集哪些資料、誰看得到、使用哪些第三方服務，以及你可以怎麼處理自己的資料。",
      },
      {
        slug: "terms",
        label: "服務條款",
        description: "使用揪帳前請閱讀的服務條款：服務內容、使用規範與責任範圍。",
      },
    ],
  },
];

export const HELP_PAGES: HelpPage[] = HELP_GROUPS.flatMap((g) => g.pages);

export function helpPage(slug: string): HelpPage {
  const page = HELP_PAGES.find((p) => p.slug === slug);
  if (!page) throw new Error(`Unknown help page: ${slug}`);
  return page;
}
