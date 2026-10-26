import https from "node:https";
import sharp from "sharp";

// Only existing public event imagery from established provider CDNs. No
// caller URL is fetched, no redirects, local networks, cookies or auth tokens.
const HOSTS = new Set(["images.unsplash.com", "s1.ticketm.net", "img.evbuc.com", "cdn.evbuc.com", "firebasestorage.googleapis.com"]);
export function thumbnailURL(value: unknown): URL | null {
  if (typeof value !== "string" || value.length > 3000) return null;
  try {
    const u = new URL(value);
    return u.protocol === "https:" && !u.username && !u.password && (!u.port || u.port === "443") && HOSTS.has(u.hostname) ? u : null;
  } catch { return null; }
}
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export async function compressThumbnail(bytes: Buffer): Promise<Buffer> {
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error("Image exceeds thumbnail input limit");
  // No vector/document decoders. Resize pixels, remove EXIF (including GPS),
  // and use only the first frame. The stored JPEG is at most 320 x 240.
  const image = sharp(bytes, { limitInputPixels: 16_000_000, failOn: "warning", pages: 1 });
  const info = await image.metadata();
  if (!["jpeg", "png", "webp", "gif", "avif"].includes(info.format ?? "")) throw new Error("Unsupported thumbnail image");
  const jpeg = await image.rotate().resize(320, 240, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 60 }).toBuffer();
  if (jpeg.length > 40_000) throw new Error("Thumbnail exceeds output limit");
  return jpeg;
}
export async function fetchThumbnail(value: unknown): Promise<string | null> {
  const url = thumbnailURL(value);
  if (!url) return null;
  const bytes = await new Promise<Buffer>((resolve, reject) => {
    const request = https.get(url, { headers: { "accept": "image/jpeg,image/png,image/webp", "accept-encoding": "identity" } }, (response) => {
      if (response.statusCode !== 200 || !/^image\/(jpeg|png|webp|gif|avif)(?:;|$)/i.test(String(response.headers["content-type"]))) {
        response.destroy(); reject(new Error("Thumbnail response unavailable")); return;
      }
      let count = 0; const parts: Buffer[] = [];
      response.on("data", (part: Buffer) => {
        count += part.length;
        if (count > MAX_IMAGE_BYTES) response.destroy(new Error("Image exceeds download limit")); else parts.push(part);
      });
      response.on("error", reject);
      response.on("end", () => resolve(Buffer.concat(parts)));
    });
    const timeout = setTimeout(() => request.destroy(new Error("Thumbnail timed out")), 5000);
    request.on("close", () => clearTimeout(timeout)); request.on("error", reject);
  });
  return (await compressThumbnail(bytes)).toString("base64");
}
