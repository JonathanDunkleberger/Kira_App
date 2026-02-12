const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

const srcDir = path.join(__dirname, "../public/worklets/models/Kira/suki酱.8192");
const outDir = path.join(__dirname, "../public/worklets/models/Kira/suki酱.2048");

fs.mkdirSync(outDir, { recursive: true });

const files = fs.readdirSync(srcDir).filter(f => f.endsWith(".png"));

(async () => {
  for (const file of files) {
    console.log(`Resizing ${file}...`);
    await sharp(path.join(srcDir, file))
      .resize(2048, 2048, { fit: "fill" })
      .png({ quality: 90 })
      .toFile(path.join(outDir, file));
    console.log(`Done: ${file}`);
  }
  console.log("All textures resized to 2048x2048.");
})();
