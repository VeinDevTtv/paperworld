import { getProviderStatus } from "../../../server/providers";
import { apiErrorResponse, assertLocalSameOrigin, enforceRateLimit } from "../../../server/security";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  try {
    assertLocalSameOrigin(request);
    enforceRateLimit("providers", 60, 60_000);
    const status = await getProviderStatus();
    return Response.json(status, { headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
