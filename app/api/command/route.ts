import { proposeCommand } from "../../../server/providers";
import {
  acquireProviderSlot,
  apiErrorResponse,
  assertJsonPost,
  assertLocalSameOrigin,
  enforceRateLimit,
  readJsonBody,
} from "../../../server/security";

export const runtime = "nodejs";
export const maxDuration = 90;

export async function POST(request: Request): Promise<Response> {
  try {
    assertLocalSameOrigin(request, { requireOrigin: true });
    assertJsonPost(request);
    enforceRateLimit("command", 18, 60_000);
    const body = await readJsonBody(request, 192_000);
    const release = acquireProviderSlot();
    try {
      const proposal = await proposeCommand(body);
      return Response.json(proposal, { headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
    } finally {
      release();
    }
  } catch (error) {
    return apiErrorResponse(error);
  }
}
