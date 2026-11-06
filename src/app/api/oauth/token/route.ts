import { authenticateClient, exchangeCode, OauthGrantError, refreshTokens } from "@/lib/oauth-db";
import { oauthError, oauthJson, preflight, withOauth } from "@/lib/oauth-http";
import { clientCredentials } from "@/lib/oauth";
import { enforceOauthRateLimit } from "@/lib/rate-limit";
import { RATE_RULES } from "@/lib/rate-limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Code and refresh exchanges (RFC 6749 §4.1.3, §6). Form-encoded, no cookie. */
export const POST = withOauth(async (req) => {
  await enforceOauthRateLimit(req, RATE_RULES.oauthTokenIp);
  const form = new URLSearchParams(await req.text());
  const { clientId, clientSecret } = clientCredentials(req.headers.get("authorization"), form);
  const client = await authenticateClient(clientId, clientSecret);
  if (!client) {
    return oauthError("invalid_client", "client authentication failed", 401, {
      "WWW-Authenticate": "Basic",
    });
  }
  try {
    const grant = form.get("grant_type");
    if (grant === "authorization_code") {
      return oauthJson(
        await exchangeCode(client, {
          code: form.get("code"),
          redirectUri: form.get("redirect_uri"),
          verifier: form.get("code_verifier"),
        }),
      );
    }
    if (grant === "refresh_token") {
      return oauthJson(await refreshTokens(client, form.get("refresh_token")));
    }
    return oauthError("unsupported_grant_type", "use authorization_code or refresh_token");
  } catch (err) {
    if (err instanceof OauthGrantError) return oauthError(err.error, err.message);
    throw err;
  }
});
export const OPTIONS = preflight;
