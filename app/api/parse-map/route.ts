import { z } from "zod";
import { paperMapSchema } from "../../../lib/schema";
import { parseMapImage } from "../../../server/providers";
import {
  ApiError,
  acquireProviderSlot,
  apiErrorResponse,
  assertJsonPost,
  assertLocalSameOrigin,
  enforceRateLimit,
  readJsonBody,
} from "../../../server/security";

export const runtime = "nodejs";
export const maxDuration = 90;

const requestSchema = z.object({
  image: z.string().min(1).max(2_100_000),
  previousMap: paperMapSchema.optional(),
}).strict();

export async function POST(request: Request): Promise<Response> {
  try {
    assertLocalSameOrigin(request, { requireOrigin: true });
    assertJsonPost(request);
    enforceRateLimit("parse-map", 6, 60_000);
    const body = requestSchema.safeParse(await readJsonBody(request, 2_200_000));
    if (!body.success) throw new ApiError(400, "invalid_parse_request");
    const release = acquireProviderSlot();
    try {
      const result = await parseMapImage(body.data.image, body.data.previousMap);
      return Response.json(result, { headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
    } finally {
      release();
    }
  } catch (error) {
    return apiErrorResponse(error);
  }
}
