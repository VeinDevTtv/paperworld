import assert from "node:assert/strict";
import test from "node:test";
import { preparePhoto } from "../lib/prepare-photo";

test("small photos are preserved without decoding or recompression", async () => {
  const file = new File(["photo"], "map.png", { type: "image/png" });
  assert.equal(await preparePhoto(file), file);
});

test("large photo uses EXIF-aware decode, bounded geometry and a scan-sized JPEG", async () => {
  const originalBitmap = globalThis.createImageBitmap;
  const originalDocument = globalThis.document;
  let closed = false;
  let orientation: string | undefined;
  const canvas = {
    width: 0, height: 0,
    getContext: () => ({ fillStyle: "", fillRect() {}, drawImage() {} }),
    toBlob: (callback: (blob: Blob) => void) => callback(new Blob([new Uint8Array(100)], { type: "image/jpeg" })),
  };
  globalThis.createImageBitmap = (async (_image, options) => {
    orientation = typeof options === "object" ? options.imageOrientation : undefined;
    return { width: 6000, height: 4000, close: () => { closed = true; } } as ImageBitmap;
  }) as typeof createImageBitmap;
  globalThis.document = { createElement: () => canvas } as unknown as Document;
  try {
    const result = await preparePhoto(new File([new Uint8Array(200)], "map.png", { type: "image/png" }), 150);
    assert.equal(orientation, "from-image");
    assert.equal(canvas.width, 3200);
    assert.equal(canvas.height, 2133);
    assert.equal(result.type, "image/jpeg");
    assert.equal(result.name, "map.jpg");
    assert.ok(result.size <= 150);
    assert.equal(closed, true);
  } finally {
    globalThis.createImageBitmap = originalBitmap;
    globalThis.document = originalDocument;
  }
});

