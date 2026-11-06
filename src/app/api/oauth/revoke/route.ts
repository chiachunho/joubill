import { authenticateClient, revokeByToken } from "@/lib/oauth-db";
import { oauthError, oauthJson, preflight, withOauth } from "@/lib/oauth-http";
import { clientCredentials } from "@/lib/oauth";
import { enforceOauthRateLimit } from "@/lib/rate-limit";
import { RATE_RULES } from "@/lib/rate-limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** RFC 7009. Revoking a token ends the whole connection; an unknown token is still a 200. */
export const POST = withOauth(async (req) => {
  await enforceOauthRateLimit(req, RATE_RULES.oauthTokenIp);
  const form = new URLSearchParams(await req.text());
  const { clientId, clientSecret } = clientCredentials(req.headers.get("authorization"), form);
  const client = await authenticateClient(clientId, clientSecret);
  if (!client) return oauthError("invalid_client", "client authentication failed", 401);
  const token = form.get("token");
  if (token) await revokeByToken(client, token);
  return oauthJson({});
});
export const OPTIONS = preflight;
