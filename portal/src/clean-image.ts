// Removes location and all other photo metadata (EXIF, XMP) before upload
// (Trello A16). The image is redrawn in the browser, which keeps only the
// pixels. It is turned upright first, so phone photos don't end up sideways.
// PNG stays PNG, WebP stays WebP, everything else becomes JPEG.
export async function cleanImage(file: File): Promise<File> {
  const type = file.type === 'image/png' || file.type === 'image/webp' ? file.type : 'image/jpeg';
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('This image could not be read. Try saving it again as PNG or JPG.');
  }
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser could not prepare the image.');
  if (type === 'image/jpeg') {
    // JPEG has no transparency: fill white so transparent parts don't turn black.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, type, 0.9));
  if (!blob) throw new Error('This browser could not prepare the image.');
  return new File([blob], file.name, { type: blob.type || type, lastModified: Date.now() });
}
