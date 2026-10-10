import sharp from "sharp";
import { encodePhoto, optimizePhoto } from "./image-tools";

/** Photo-like content (PNG stores it far larger than JPEG would). */
const noise = (w: number, h: number, channels: 3 | 4, alpha = 255) => {
  const px = Buffer.alloc(w * h * channels);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * channels;
      [px[o], px[o + 1], px[o + 2]] = [x % 256, y % 256, ((x * y) >> 8) % 256];
      if (channels === 4) px[o + 3] = alpha;
    }
  return sharp(px, { raw: { width: w, height: h, channels } });
};

describe("photo optimisation (PhotoEncoder rules)", () => {
  it("shrinks a big photo to 2560 px JPEG", async () => {
    const png = await noise(3000, 1000, 3).png().toBuffer();
    const r = await encodePhoto(png, ".png");
    expect(r).not.toBeNull();
    expect([r!.width, r!.height, r!.extension]).toEqual([2560, 853, ".jpg"]);
  });
  it("keeps a small transparent logo as sent", async () => {
    const png = await noise(200, 200, 4, 100).png().toBuffer();
    expect(await encodePhoto(png, ".png")).toBeNull();
  });
  it("keeps a large transparent logo's format", async () => {
    const png = await noise(2600, 100, 4, 100).png().toBuffer();
    const r = await encodePhoto(png, ".png");
    expect([r?.extension, r?.width]).toEqual([".png", 2560]);
  });
  it("leaves non-photos and undecodable files alone", async () => {
    const pdf = { originalname: "a.pdf", buffer: Buffer.from("%PDF-1.4"), size: 8, mimetype: "application/pdf" };
    expect((await optimizePhoto(pdf)).changed).toBe(false);
    const bad = { originalname: "a.jpg", buffer: Buffer.from("not an image"), size: 12, mimetype: "image/jpeg" };
    expect((await optimizePhoto(bad)).changed).toBe(false);
  });
  it("renames the optimised upload to .jpg", async () => {
    const png = await noise(1200, 900, 3).png().toBuffer();
    const r = await optimizePhoto({ originalname: "Team photo.png", buffer: png, size: png.length, mimetype: "image/png" });
    expect([r.changed, r.file.originalname, r.file.mimetype]).toEqual([true, "Team photo.jpg", "image/jpeg"]);
  });
});
