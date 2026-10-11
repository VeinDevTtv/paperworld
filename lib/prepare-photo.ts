/** Decode with browser EXIF orientation, then compress locally before upload. */
export async function preparePhoto(file: File, limit = 1_500_000): Promise<File> {
  if (file.size <= limit) return file;
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Photo preparation is unavailable in this browser.");
    let edge = Math.min(3200, Math.max(bitmap.width, bitmap.height));
    while (edge >= 1200) {
      const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      context.fillStyle = "white";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.94, 0.88, 0.8]) {
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
        if (blob && blob.size <= limit) {
          return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
        }
      }
      edge = Math.floor(edge * 0.8);
    }
    throw new Error("This photo could not fit the scan limit without reducing label detail. Crop closer to the paper and try again.");
  } finally {
    bitmap.close();
  }
}
