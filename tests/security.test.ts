import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  acquireProviderSlot,
  ApiError,
  apiErrorResponse,
  assertLocalSameOrigin,
  enforceRateLimit,
  readJsonBody,
} from "../server/security";

test("same-origin checks allow equivalent loopback aliases but bind Origin to Host", () => {
  const allowed = new Request("http://localhost:3000/api/providers", {
    headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000", "sec-fetch-site": "same-origin" },
  });
  assert.doesNotThrow(() => assertLocalSameOrigin(allowed));

  const mismatchedOrigin = new Request("http://localhost:3000/api/providers", {
    headers: { host: "127.0.0.1:3000", origin: "http://localhost:3000", "sec-fetch-site": "same-origin" },
  });
  assert.throws(() => assertLocalSameOrigin(mismatchedOrigin), (error) => error instanceof ApiError && error.code === "cross_origin_request");
});

test("same-origin checks reject cross-site and non-loopback requests", () => {
  const crossSite = new Request("http://127.0.0.1:3000/api/providers", {
    headers: { host: "127.0.0.1:3000", origin: "http://example.com", "sec-fetch-site": "cross-site" },
  });
  assert.throws(() => assertLocalSameOrigin(crossSite), (error) => error instanceof ApiError && error.code === "cross_site_request");

  const publicTarget = new Request("https://example.com/api/providers", {
    headers: { host: "example.com", origin: "https://example.com", "sec-fetch-site": "same-origin" },
  });
  assert.throws(() => assertLocalSameOrigin(publicTarget), (error) => error instanceof ApiError && error.code === "local_only");
});

test("JSON body reader rejects oversized streamed input without a length header", async () => {
  const request = new Request("http://127.0.0.1/api/command", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: "x".repeat(30) }),
  });
  await assert.rejects(readJsonBody(request, 16), (error) => error instanceof ApiError && error.code === "request_too_large");
});

test("provider concurrency and request rate limits fail with bounded API errors", () => {
  const releaseFirst = acquireProviderSlot();
  const releaseSecond = acquireProviderSlot();
  try {
    assert.throws(() => acquireProviderSlot(), (error) => error instanceof ApiError && error.code === "provider_busy");
  } finally {
    releaseFirst();
    releaseSecond();
  }

  const key = `security-test-${randomUUID()}`;
  enforceRateLimit(key, 1, 60_000);
  assert.throws(() => enforceRateLimit(key, 1, 60_000), (error) => error instanceof ApiError && error.code === "rate_limited");
});

test("unexpected route errors never expose internal messages", async () => {
  const response = apiErrorResponse(new Error("sensitive internal detail"));
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "internal_error" });
});
