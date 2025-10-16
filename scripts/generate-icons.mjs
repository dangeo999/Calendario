import sharp from "sharp";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "public", "icons", "Esproweb.png");
const OUT = path.join(ROOT, "public", "icons");

if (!fs.existsSync(SRC)) {
  console.error("Source image missing: " + SRC);
  process.exit(1);
}
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

// 192x192
await sharp(SRC)
  .resize(192, 192, { fit: "contain", background: { r:0,g:0,b:0,alpha:0 }})
  .png()
  .toFile(path.join(OUT, "icon-192.png"));

// 512x512
await sharp(SRC)
  .resize(512, 512, { fit: "contain", background: { r:0,g:0,b:0,alpha:0 }})
  .png()
  .toFile(path.join(OUT, "icon-512.png"));

// maskable 512 con logo ~72% e padding trasparente
const size = 512;
const logoSize = Math.round(size * 0.72);
const logoBuffer = await sharp(SRC)
  .resize(logoSize, logoSize, { fit: "contain", background: { r:0,g:0,b:0,alpha:0 }})
  .png()
  .toBuffer();

await sharp({
  create: {
    width: size,
    height: size,
    channels: 4,
    background: { r:0,g:0,b:0,alpha:0 }
  }
})
  .composite([{ input: logoBuffer, gravity: "center" }])
  .png()
  .toFile(path.join(OUT, "icon-maskable.png"));

console.log("✅ Icons generated in public/icons: icon-192.png, icon-512.png, icon-maskable.png");
