export const MEDIA_ARTWORK_SIZE = 512;
export const MEDIA_ARTWORK_TIMEOUT_MS = 3000;

function decodeImage(src: string, signal: AbortSignal) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image(); image.decoding = "async"; image.crossOrigin = "anonymous";
    let settled = false;
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true; clearTimeout(timer); signal.removeEventListener("abort", abort);
      if (error !== undefined) { image.removeAttribute("src"); reject(error); } else resolve(image);
    };
    const abort = () => finish(new DOMException("Artwork cancelled", "AbortError"));
    const timer = setTimeout(() => finish(new Error("Artwork decode timed out")), MEDIA_ARTWORK_TIMEOUT_MS);
    if (signal.aborted) { abort(); return; }
    signal.addEventListener("abort", abort, { once: true });
    try { image.src = src; image.decode().then(() => finish(), finish); } catch (error) { finish(error); }
  });
}

/** Keep original library artwork intact. Publish a small, decoded JPEG with an
 * explicit size and MIME type to the OS/receiver instead of the uploaded file. */
export async function prepareMediaArtwork(src: string, signal: AbortSignal): Promise<MediaImage> {
  const image = await decodeImage(src, signal);
  try {
    signal.throwIfAborted();
    const width = image.naturalWidth, height = image.naturalHeight;
    if (!width || !height) throw new Error("Artwork has no dimensions");
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = MEDIA_ARTWORK_SIZE;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Artwork could not be resized");
    context.fillStyle = "#ffffff"; context.fillRect(0, 0, canvas.width, canvas.height);
    const scale = Math.min(canvas.width / width, canvas.height / height);
    context.drawImage(image, (canvas.width - width * scale) / 2, (canvas.height - height * scale) / 2, width * scale, height * scale);
    const jpeg = canvas.toDataURL("image/jpeg", .82);
    if (!jpeg.startsWith("data:image/jpeg;")) throw new Error("JPEG artwork is unavailable");
    const decoded = await decodeImage(jpeg, signal); decoded.removeAttribute("src");
    signal.throwIfAborted();
    return { src: jpeg, sizes: `${MEDIA_ARTWORK_SIZE}x${MEDIA_ARTWORK_SIZE}`, type: "image/jpeg" };
  } finally { image.removeAttribute("src"); }
}
