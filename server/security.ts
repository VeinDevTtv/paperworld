export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfterSeconds?: number;

  constructor(status: number, code: string, retryAfterSeconds?: number) {
    super(code);
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

const rateBuckets = new Map<string, { count: number; resetsAt: number }>();
let activeProviderRequests = 0;
const MAX_PROVIDER_CONCURRENCY = 2;

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "::1") return true;
  const octets = host.split(".");
  return octets.length === 4 && octets[0] === "127" && octets.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

export function assertLocalSameOrigin(request: Request, options: { requireOrigin?: boolean } = {}): void {
  const target = new URL(request.url);
  if (!isLoopbackHost(target.hostname)) throw new ApiError(403, "local_only");
  if (target.protocol !== "http:" && target.protocol !== "https:") throw new ApiError(403, "invalid_origin");

  const host = request.headers.get("host");
  if (!host) throw new ApiError(403, "invalid_host");
  let requestAuthority: URL;
  try {
    requestAuthority = new URL(`${target.protocol}//${host}`);
  } catch {
    throw new ApiError(403, "invalid_host");
  }
  if (requestAuthority.username || requestAuthority.password || requestAuthority.pathname !== "/" || requestAuthority.search || requestAuthority.hash || !isLoopbackHost(requestAuthority.hostname)) {
    throw new ApiError(403, "invalid_host");
  }

  const site = request.headers.get("sec-fetch-site")?.toLowerCase();
  if (site && site !== "same-origin" && site !== "none") throw new ApiError(403, "cross_site_request");

  const originHeader = request.headers.get("origin");
  if (!originHeader) {
    if (options.requireOrigin || site !== "same-origin") throw new ApiError(403, "origin_required");
    return;
  }
  let origin: URL;
  try {
    origin = new URL(originHeader);
  } catch {
    throw new ApiError(403, "invalid_origin");
  }
  if (origin.origin !== requestAuthority.origin || origin.protocol !== target.protocol || !isLoopbackHost(origin.hostname)) throw new ApiError(403, "cross_origin_request");
}

export function assertJsonPost(request: Request): void {
  if (request.method !== "POST") throw new ApiError(405, "method_not_allowed");
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") throw new ApiError(415, "json_required");
}

export async function readJsonBody(request: Request, maxBytes: number): Promise<unknown> {
  const contentLength = request.headers.get("content-length");
  if (contentLength) {
    if (!/^\d+$/.test(contentLength)) throw new ApiError(400, "invalid_content_length");
    if (Number(contentLength) > maxBytes) throw new ApiError(413, "request_too_large");
  }
  if (!request.body) throw new ApiError(400, "request_body_required");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new ApiError(413, "request_too_large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  try {
    return JSON.parse(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8")) as unknown;
  } catch {
    throw new ApiError(400, "invalid_json");
  }
}

export function enforceRateLimit(key: string, limit: number, windowMs: number): void {
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || bucket.resetsAt <= now) {
    rateBuckets.set(key, { count: 1, resetsAt: now + windowMs });
    return;
  }
  if (bucket.count >= limit) {
    throw new ApiError(429, "rate_limited", Math.max(1, Math.ceil((bucket.resetsAt - now) / 1000)));
  }
  bucket.count += 1;
}

export function acquireProviderSlot(): () => void {
  if (activeProviderRequests >= MAX_PROVIDER_CONCURRENCY) throw new ApiError(429, "provider_busy", 2);
  activeProviderRequests += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeProviderRequests = Math.max(0, activeProviderRequests - 1);
  };
}

export function apiErrorResponse(error: unknown): Response {
  const apiError = error instanceof ApiError ? error : new ApiError(500, "internal_error");
  const headers = new Headers({ "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
  if (apiError.retryAfterSeconds) headers.set("retry-after", String(apiError.retryAfterSeconds));
  return new Response(JSON.stringify({ error: apiError.code }), { status: apiError.status, headers });
}
