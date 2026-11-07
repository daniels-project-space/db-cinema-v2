export async function createCleanChatImage(file: File): Promise<File> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("Choose a JPG, PNG or WebP image.");
  let bitmap: ImageBitmap | undefined, objectUrl: string | undefined;
  try {
    let image: CanvasImageSource, width: number, height: number;
    if (typeof createImageBitmap === "function") {
      try { bitmap = await createImageBitmap(file, { imageOrientation: "from-image" }); } catch {}
    }
    if (bitmap) {
      image = bitmap; width = bitmap.width; height = bitmap.height;
    } else {
      objectUrl = URL.createObjectURL(file);
      const element = new Image();
      await new Promise<void>((resolve, reject) => { element.onload = () => resolve(); element.onerror = () => reject(new Error("This image could not be opened.")); element.src = objectUrl!; });
      image = element; width = element.naturalWidth; height = element.naturalHeight;
    }
    if (!width || !height || width * height > 20_000_000) throw new Error("This image is too large to prepare safely.");
    const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
    const context = canvas.getContext("2d"); if (!context) throw new Error("This browser cannot prepare a cleaned image.");
    context.drawImage(image, 0, 0);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/png"));
    canvas.width = 0; canvas.height = 0;
    if (!blob || !blob.size || blob.size > 10 * 1024 * 1024) throw new Error("The cleaned image is too large to send. Choose a smaller image.");
    const base = file.name.replace(/\.[^.]*$/, "").slice(0, 100) || "image";
    return new File([blob], `${base}-cleaned.png`, { type: "image/png" });
  } finally {
    bitmap?.close();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}
