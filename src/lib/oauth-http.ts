import { NextResponse } from "next/server";

import { HttpError, TooManyRequestsError } from "@/lib/auth/errors";
import { appUrl } from "@/lib/help-url";
import { SUPPORTED_SCOPES } from "@/lib/oauth";

/**
 * The HTTP side of the OAuth server that every endpoint shares (issue #152): absolute URLs,
 * the discovery documents, RFC 6749 error bodies and CORS. The token, register and revoke
 * endpoints are called by browser-based clients too, with no cookie, so they answer any
 * origin; the consent endpoint is cookie-authenticated and does not.
 */

export const issuer = () => appUrl("/").replace(/\/$/, "");
export const mcpUrl = () => appUrl("/api/mcp");
export const metadataUrl = () => appUrl("/.well-known/oauth-protected-resource");
export const consentUrl = () => appUrl("/app/oauth/consent");

export function protectedResourceMetadata() {
  return {
    resource: mcpUrl(),
    authorization_servers: [issuer()],
    scopes_supported: [...SUPPORTED_SCOPES],
    bearer_methods_supported: ["header"],
    resource_name: "揪帳",
    resource_documentation: appUrl("/help/mcp"),
  };
}

export function authorizationServerMetadata() {
  return {
    issuer: issuer(),
    authorization_endpoint: appUrl("/api/oauth/authorize"),
    token_endpoint: appUrl("/api/oauth/token"),
    registration_endpoint: appUrl("/api/oauth/register"),
    revocation_endpoint: appUrl("/api/oauth/revoke"),
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    scopes_supported: [...SUPPORTED_SCOPES],
    authorization_response_iss_parameter_supported: true,
    service_documentation: appUrl("/help/mcp"),
  };
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, MCP-Protocol-Version",
  "Access-Control-Max-Age": "86400",
} as const;
const NO_STORE = { "Cache-Control": "no-store", Pragma: "no-cache" } as const;

export const preflight = () => new Response(null, { status: 204, headers: CORS });

export function oauthJson(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { ...CORS, ...NO_STORE, ...extra } });
}

/** An RFC 6749 §5.2 error body. */
export function oauthError(
  error: string,
  description: string,
  status = 400,
  extra: Record<string, string> = {},
) {
  return oauthJson({ error, error_description: description }, status, extra);
}

/** Wraps a public OAuth endpoint: HttpErrors (a 429, say) become OAuth-shaped answers. */
export function withOauth(handler: (req: Request) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    try {
      return await handler(req);
    } catch (err) {
      if (err instanceof TooManyRequestsError) {
        return oauthError("temporarily_unavailable", "too many requests", 429, {
          "Retry-After": String(err.retryAfter),
        });
      }
      if (err instanceof HttpError) return oauthError("invalid_request", err.message, err.status);
      console.error("[oauth] request failed", err);
      return oauthError("server_error", "something went wrong", 500);
    }
  };
}

export function metadataResponse(body: unknown) {
  return NextResponse.json(body, {
    headers: { ...CORS, "Cache-Control": "public, max-age=300" },
  });
}
