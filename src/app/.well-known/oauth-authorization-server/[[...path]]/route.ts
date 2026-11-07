import { authorizationServerMetadata, metadataResponse, preflight } from "@/lib/oauth-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** RFC 8414: where to register, authorize and exchange codes. */
export const GET = () => metadataResponse(authorizationServerMetadata());
export const OPTIONS = preflight;
