import dns from "node:dns";
import https from "node:https";
import { isIP } from "node:net";

import { MAX_RECEIPT_BYTES } from "@/lib/receipt-upload";

/** Raised for anything wrong with a receipt URL; the message is safe to show an agent. */
export class ReceiptFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReceiptFetchError";
  }
}

function ipv4Public(a: number, b: number): boolean {
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
  if (a === 169 && b === 254) return false; // link-local, cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0) return false; // IETF protocol assignments, TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
  return true;
}

/** True only for an address on the public internet. Anything unparseable is refused. */
export function isPublicAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) {
    const [a, b] = ip.split(".").map(Number);
    return ipv4Public(a, b);
  }
  if (kind !== 6) return false;
  const v6 = ip.toLowerCase();
  // IPv4-mapped (::ffff:a.b.c.d or ::ffff:aabb:ccdd): judge the embedded IPv4 address.
  const dotted = v6.match(/^(?:0*:)*:?ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) return isPublicAddress(dotted[1]);
  const hex = v6.match(/^(?:0*:)*:?ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const hi = parseInt(hex[1], 16);
    return ipv4Public(hi >> 8, hi & 0xff);
  }
  if (v6 === "::" || v6 === "::1") return false;
  const first = parseInt(v6.split(":")[0] || "0", 16);
  if ((first & 0xfe00) === 0xfc00) return false; // fc00::/7 unique local
  if ((first & 0xffc0) === 0xfe80) return false; // fe80::/10 link-local
  if ((first & 0xff00) === 0xff00) return false; // multicast
  if (v6.startsWith("64:ff9b:")) return false; // NAT64 can reach private IPv4
  if (v6.startsWith("2001:db8:") || v6.startsWith("2002:")) return false;
  return true;
}

/** Validates the URL's shape before any lookup. */
export function parseReceiptUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ReceiptFetchError("the image url is not a valid url");
  }
  if (url.protocol !== "https:") throw new ReceiptFetchError("the image url must be https");
  if (url.username || url.password) {
    throw new ReceiptFetchError("the image url must not contain credentials");
  }
  if (url.port && url.port !== "443") {
    throw new ReceiptFetchError("the image url must use the default https port");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) !== 0 && !isPublicAddress(host)) {
    throw new ReceiptFetchError("the image url points to a private address");
  }
  return url;
}

/**
 * Resolves and checks in the same step the socket connects with, so the address that was
 * judged is the address that is used (a second lookup could be answered differently).
 */
function checkedLookup(
  hostname: string,
  options: dns.LookupOptions,
  cb: (err: Error | null, address: string | dns.LookupAddress[], family?: number) => void,
) {
  dns.lookup(hostname, { all: true }, (err, addresses) => {
    if (err) return cb(err, "", 0);
    if (addresses.length === 0 || !addresses.every((a) => isPublicAddress(a.address))) {
      return cb(new ReceiptFetchError("the image url points to a private address"), "", 0);
    }
    if (options.all) return cb(null, addresses);
    cb(null, addresses[0].address, addresses[0].family);
  });
}

const TIMEOUT_MS = 10_000;

/**
 * Downloads an image from a public https URL: no redirects, at most 10 MB, 10 s overall.
 * The bytes are checked by the caller (`sniffImage`), never the response's content type.
 */
export async function fetchReceiptImage(raw: string): Promise<Uint8Array> {
  const url = parseReceiptUrl(raw);
  return new Promise<Uint8Array>((resolve, reject) => {
    const fail = (message: string) => reject(new ReceiptFetchError(message));
    const req = https.request(
      url,
      { method: "GET", lookup: checkedLookup as never, headers: { accept: "image/*" } },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          return fail(
            res.statusCode && res.statusCode >= 300 && res.statusCode < 400
              ? "the image url redirects; send the final url"
              : `the image url answered ${res.statusCode}`,
          );
        }
        const declared = Number(res.headers["content-length"]);
        if (declared > MAX_RECEIPT_BYTES) {
          res.resume();
          return fail("the image is larger than 10 MB");
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > MAX_RECEIPT_BYTES) {
            req.destroy();
            return fail("the image is larger than 10 MB");
          }
          chunks.push(c);
        });
        res.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))));
        res.on("error", () => fail("could not download the image"));
      },
    );
    req.setTimeout(TIMEOUT_MS, () => {
      req.destroy();
      fail("the image url took too long to answer");
    });
    req.on("error", (err) =>
      fail(err instanceof ReceiptFetchError ? err.message : "could not download the image"),
    );
    req.end();
  });
}
