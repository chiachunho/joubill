import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Logo } from "@/components/Logo";

export default function Home() {
  return (
    <main className="container mx-auto flex min-h-screen max-w-3xl flex-col gap-8 py-16">
      <header className="space-y-4">
        <Logo size={72} />
        <div className="space-y-2">
          <h1 className="text-4xl font-bold tracking-tight">揪帳</h1>
          <p className="text-muted-foreground">
            聚餐、旅遊、下午茶，每次到了結帳時刻總是最尷尬？用揪帳，就這樣算清楚。
          </p>
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>開始使用</CardTitle>
          <CardDescription>把 Bot 加進群組，輸入 /start，就這樣。</CardDescription>
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
