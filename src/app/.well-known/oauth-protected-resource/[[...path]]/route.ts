import { metadataResponse, preflight, protectedResourceMetadata } from "@/lib/oauth-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** RFC 9728: tells a client which authorization server protects `/api/mcp`. */
export const GET = () => metadataResponse(protectedResourceMetadata());
export const OPTIONS = preflight;
