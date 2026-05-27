import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function Home() {
  return (
    <main className="container mx-auto flex min-h-screen max-w-3xl flex-col gap-8 py-16">
      <header className="space-y-3">
        <h1 className="text-4xl font-bold tracking-tight">Splitbill</h1>
        <p className="text-muted-foreground">
          Splitwise 風格的 Telegram 群組分帳 Bot。在群組裡記支出，自動算餘額與最少筆數還款建議。
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>開始使用</CardTitle>
          <CardDescription>把 Bot 加進群組後輸入 /start 即可註冊。</CardDescription>
        </CardHeader>
        <CardContent className="flex gap-3">
          <Button asChild>
            <a href="https://t.me/" target="_blank" rel="noreferrer">
              開啟 Telegram
            </a>
          </Button>
          <Button variant="secondary" asChild>
            <a href="/mini">Mini App 預覽</a>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
