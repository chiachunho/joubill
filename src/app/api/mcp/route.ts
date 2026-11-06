import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { NextResponse } from "next/server";

import { getMcpAuth } from "@/lib/auth/mcp";
import { HttpError } from "@/lib/auth/errors";
import { createMcpServer } from "@/lib/mcp/server";
import { metadataUrl } from "@/lib/oauth-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Points a client at the OAuth metadata (RFC 9728), which is how Claude.ai and ChatGPT find
 * the sign-in. A request that carried a token the server refused says so (`invalid_token`),
 * which is the client's cue to refresh instead of starting over.
 */
const challenge = (hadToken: boolean) =>
  `Bearer resource_metadata="${metadataUrl()}"${hadToken ? ', error="invalid_token"' : ""}`;

/** Stateless Streamable HTTP: one server and transport per request, JSON replies. */
async function handle(req: Request): Promise<Response> {
  let auth;
  try {
    auth = await getMcpAuth(req);
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json(
        { error: err.message },
        {
          status: err.status,
          headers:
            err.status === 401
              ? { "WWW-Authenticate": challenge(req.headers.has("authorization")) }
              : undefined,
        },
      );
    }
    throw err;
  }

  const server = createMcpServer(auth);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(req);
  } finally {
    // The response body is already built in JSON mode, so closing here is safe.
    void server.close().catch(() => {});
  }
}

export const POST = handle;

// Stateless: there is no session to stream to or to end, and an open SSE stream would pin a
// serverless invocation.
const notAllowed = () =>
  NextResponse.json({ error: "method not allowed" }, { status: 405, headers: { Allow: "POST" } });
export const GET = notAllowed;
export const DELETE = notAllowed;
