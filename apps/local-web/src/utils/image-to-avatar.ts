// Downscale a picked image to a small square avatar data URL. Avatars live
// in localStorage (the customize store), so the ceiling is deliberate: a
// 96px PNG is a few KB — the raw camera photo would blow the storage quota.

const AVATAR_SIZE = 96;
const MAX_SOURCE_BYTES = 10 * 1024 * 1024;

export async function imageFileToAvatarDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith("image/"))
    throw new Error(
      `"${file.name}" is not an image — pick a PNG, JPEG, or WebP file.`,
    );
  if (file.size > MAX_SOURCE_BYTES)
    throw new Error(
      `"${file.name}" is larger than 10 MB — pick a smaller image.`,
    );

  const bitmap = await createImageBitmap(file);
  try {
    // Cover-crop to a square: scale the short side to AVATAR_SIZE, center
    // the long side.
    const scale = AVATAR_SIZE / Math.min(bitmap.width, bitmap.height);
    const drawWidth = bitmap.width * scale;
    const drawHeight = bitmap.height * scale;
    const canvas = document.createElement("canvas");
    canvas.width = AVATAR_SIZE;
    canvas.height = AVATAR_SIZE;
    const context = canvas.getContext("2d");
    if (context === null)
      throw new Error("Could not prepare the image — try a different file.");
    context.drawImage(
      bitmap,
      (AVATAR_SIZE - drawWidth) / 2,
      (AVATAR_SIZE - drawHeight) / 2,
      drawWidth,
      drawHeight,
    );
    return canvas.toDataURL("image/png");
  } finally {
    bitmap.close();
  }
}
