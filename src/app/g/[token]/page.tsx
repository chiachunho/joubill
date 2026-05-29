import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { resolveSessionByToken } from "@/lib/auth";
import { verifyMagicToken } from "@/lib/auth/magicLink";
import { serverEnv } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ token: string }> };

export default async function MagicLinkPage({ params }: Params) {
  const { token } = await params;
  const groupId = verifyMagicToken(token, serverEnv().TELEGRAM_WEBHOOK_SECRET);
  if (!groupId) notFound();

  const cookieStore = await cookies();
  const sessionToken = cookieStore.get("session")?.value;
  const user = sessionToken ? await resolveSessionByToken(sessionToken) : null;

  if (user) {
    redirect(`/app/groups/${groupId}`);
  }

  // Not logged in — send to /login and come back here after
  redirect(`/login?next=/g/${encodeURIComponent(token)}`);
}
