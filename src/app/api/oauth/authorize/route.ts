import { NextResponse } from "next/server";

import { parseAuthorizeRequest, redirectWith } from "@/lib/oauth-db";
import { consentUrl, issuer } from "@/lib/oauth-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The authorization endpoint. It only checks the request and forwards the browser to the
 * consent page, which needs a login and lives in the Web App. A client or redirect URI we
 * can't trust gets an error page, never a redirect; anything else goes back to the client.
 */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const result = await parseAuthorizeRequest((k) => params.get(k));
  if (!result.ok) {
    if (!result.redirect) {
      return NextResponse.json(
        { error: result.error, error_description: result.description },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }
    return NextResponse.redirect(
      redirectWith(result.redirectUri, issuer(), {
        error: result.error,
        error_description: result.description,
        state: result.state,
      }),
    );
  }
  const to = new URL(consentUrl());
  for (const [k, v] of params) to.searchParams.set(k, v);
  return NextResponse.redirect(to.toString(), { headers: { "Cache-Control": "no-store" } });
}
