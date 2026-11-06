import { registerClient } from "@/lib/oauth-db";
import { oauthJson, preflight, withOauth } from "@/lib/oauth-http";
import { enforceOauthRateLimit } from "@/lib/rate-limit";
import { RATE_RULES } from "@/lib/rate-limits";
import { BadRequestError } from "@/lib/auth/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Dynamic client registration (RFC 7591). Open on purpose: registering grants nothing. */
export const POST = withOauth(async (req) => {
  await enforceOauthRateLimit(req, RATE_RULES.oauthRegisterIp);
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return oauthJson(
      { error: "invalid_client_metadata", error_description: "JSON body required" },
      400,
    );
  }
  let client;
  try {
    client = await registerClient(body);
  } catch (err) {
    if (err instanceof BadRequestError) {
      return oauthJson({ error: "invalid_client_metadata", error_description: err.message }, 400);
    }
    throw err;
  }
  return oauthJson(
    {
      client_id: client.clientId,
      ...(client.clientSecret && {
        client_secret: client.clientSecret,
        client_secret_expires_at: 0,
      }),
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: client.name,
      redirect_uris: client.redirectUris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: client.authMethod,
      scope: "records:read records:write",
    },
    201,
  );
});
export const OPTIONS = preflight;
