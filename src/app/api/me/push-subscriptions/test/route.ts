import { NextResponse } from "next/server";

import { getAuth } from "@/lib/auth";
import { withAuth } from "@/lib/auth/route";
import { sendTestPush } from "@/lib/push";
import { pushEndpointSchema } from "@/lib/zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 傳送測試通知: one notification to one of the caller's own devices. */
export const POST = withAuth(async (req: Request) => {
  const auth = await getAuth(req);
  const parsed = pushEndpointSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "格式錯誤" }, { status: 400 });

  const result = await sendTestPush(auth.user.id, parsed.data.endpoint);
  switch (result) {
    case "sent":
      return NextResponse.json({ ok: true });
    case "not-found":
      return NextResponse.json({ error: "這台裝置還沒開通知" }, { status: 404 });
    case "unconfigured":
      return NextResponse.json({ error: "這個站台沒有開放推播通知" }, { status: 503 });
    default:
      return NextResponse.json({ error: "送不出去，請稍後再試" }, { status: 502 });
  }
});
