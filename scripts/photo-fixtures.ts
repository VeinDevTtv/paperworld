/** Synthetic evidence only: no handwriting, camera, or inference is involved.
 * Run: npx tsx scripts/photo-fixtures.ts
 * Writes optional upload/rehearsal fixtures to ignored .local/photo-fixtures.
 */
import sharp from "sharp";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";

async function main() {
  const output = path.resolve(".local/photo-fixtures");
  await mkdir(output, { recursive: true });
  const width = 3000;
  const height = 4200;
  const pixels = Buffer.alloc(width * height * 3);
  // Deterministic grain around the paper makes every JPEG exceed the scan limit.
  let random = 42;
  for (let index = 0; index < pixels.length; index += 3) {
    random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
    const shade = 220 + random % 36;
    pixels[index] = pixels[index + 1] = pixels[index + 2] = shade;
  }
  const paper = `<rect x="150" y="150" width="2700" height="3900" fill="white"/>
    <text x="300" y="400" font-size="120">ORIENTATION: TOP</text>
    <path d="M1500 1100 L1500 2300 L600 3300 M1500 2300 L2400 3300" stroke="black" stroke-width="22" fill="none"/>
    <g font-size="110" fill="black"><text x="1150" y="950">Depot D</text>
    <text x="1600" y="2300">Junction J</text><text x="300" y="3550">Home H</text>
    <text x="2100" y="3550">Shop S</text></g>`;
  const closure = `<path d="M870 2640 L1110 2920 M1110 2640 L870 2920" stroke="#d31b25" stroke-width="45" fill="none"/>`;
  const connection = `<path d="M600 3300 L2400 3300" stroke="black" stroke-width="22" fill="none"/>`;
  const newHome = `<path d="M2400 3300 L2400 2100" stroke="black" stroke-width="22" fill="none"/>
    <circle cx="2400" cy="2100" r="34" fill="black"/><text x="2050" y="1930" font-size="110">New Home N</text>`;
  for (const [name, changes] of [
    ["exif-initial.jpg", ""],
    ["exif-blocked.jpg", closure],
    ["exif-recovered.jpg", connection + closure],
    ["exif-new-home.jpg", newHome],
  ]) {
    const portrait = await sharp(pixels, { raw: { width, height, channels: 3 } })
      .composite([{ input: Buffer.from(`<svg width="${width}" height="${height}">${paper}${changes}</svg>`) }])
      .png().toBuffer();
    const destination = path.join(output, name);
    await sharp(portrait).rotate(-90).jpeg({ quality: 100 }).withMetadata({ orientation: 6 }).toFile(destination);
    const bytes = (await stat(destination)).size;
    if (bytes <= 1_500_000) throw new Error(`${name} no longer exercises local compression (${bytes} bytes).`);
    console.log(`${destination} · ${bytes} bytes · synthetic · EXIF 6 · expected upright 3000×4200`);
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
