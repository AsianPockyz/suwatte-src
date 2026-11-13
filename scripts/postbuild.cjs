const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const distSourcesAtsuStt = path.join(root, "dist", "sources", "moe.atsu.stt");
const distRootAtsuStt = path.join(root, "dist", "moe.atsu.stt");
const distSourcesImhentaiStt = path.join(
  root,
  "dist",
  "sources",
  "org.imhentai.stt"
);
const distRootImhentaiStt = path.join(root, "dist", "org.imhentai.stt");
const distSourcesNovelfullStt = path.join(
  root,
  "dist",
  "sources",
  "org.novelfull.stt"
);
const distRootNovelfullStt = path.join(root, "dist", "org.novelfull.stt");
const sourcesJsonPath = path.join(root, "dist", "sources.json");
const rootSourcesDir = path.join(root, "sources");
const rootNovelfullStt = path.join(rootSourcesDir, "org.novelfull.stt");
const rootSourcesJsonPath = path.join(root, "sources.json");

// 1. Ensure .stt files are available in both dist/ and dist/sources/,
// and sync ONLY org.novelfull.stt to root sources/ for GitHub Pages deployment
if (fs.existsSync(distSourcesAtsuStt)) {
  fs.copyFileSync(distSourcesAtsuStt, distRootAtsuStt);
}
if (fs.existsSync(distSourcesImhentaiStt)) {
  fs.copyFileSync(distSourcesImhentaiStt, distRootImhentaiStt);
}
if (fs.existsSync(distSourcesNovelfullStt)) {
  fs.copyFileSync(distSourcesNovelfullStt, distRootNovelfullStt);
  if (!fs.existsSync(rootSourcesDir)) {
    fs.mkdirSync(rootSourcesDir, { recursive: true });
  }
  fs.copyFileSync(distSourcesNovelfullStt, rootNovelfullStt);
}

// 2. Ensure assets/ and dist/assets/ contain Atsu.png, imhentai.png, and novelfull.png
const assetsDir = path.join(root, "assets");
const distAssetsDir = path.join(root, "dist", "assets");
if (!fs.existsSync(distAssetsDir)) {
  fs.mkdirSync(distAssetsDir, { recursive: true });
}
const srcAtsuPng = path.join(assetsDir, "Atsu.png");
const srcImhentaiPng = path.join(assetsDir, "imhentai.png");
const srcNovelfullPng = fs.existsSync(path.join(assetsDir, "novelfull.png"))
  ? path.join(assetsDir, "novelfull.png")
  : path.join(assetsDir, "NovelFull.png");

if (fs.existsSync(srcAtsuPng) && !fs.existsSync(srcImhentaiPng)) {
  fs.copyFileSync(srcAtsuPng, srcImhentaiPng);
}
if (fs.existsSync(srcAtsuPng)) {
  fs.copyFileSync(srcAtsuPng, path.join(distAssetsDir, "Atsu.png"));
}
if (fs.existsSync(srcImhentaiPng)) {
  fs.copyFileSync(srcImhentaiPng, path.join(distAssetsDir, "imhentai.png"));
}
if (fs.existsSync(srcNovelfullPng)) {
  const destUpper = path.join(distAssetsDir, "NovelFull.png");
  const destLower = path.join(distAssetsDir, "novelfull.png");
  if (fs.existsSync(destUpper)) {
    fs.unlinkSync(destUpper);
  }
  fs.copyFileSync(srcNovelfullPng, destLower);
}

// 3. Normalize dist/sources.json to catalog manifest schema for moe.atsu, org.imhentai, and org.novelfull
if (fs.existsSync(sourcesJsonPath)) {
  const data = JSON.parse(fs.readFileSync(sourcesJsonPath, "utf8"));
  if (Array.isArray(data.sources)) {
    data.sources = data.sources.map((source) => {
      const cleanSource = { ...source };
      const sourceKey =
        cleanSource.id || cleanSource.sourceId || cleanSource.path;

      if (sourceKey === "org.imhentai") {
        cleanSource.id = "org.imhentai";
        cleanSource.name = "IMHentai";
        cleanSource.version = 1.9;
        cleanSource.website = "https://imhentai.xxx";
        cleanSource.rating = 2;
        cleanSource.thumbnail = "imhentai.png";
        cleanSource.languages = ["en", "ja", "zh", "es", "fr", "de", "ru"];
        cleanSource.path = "org.imhentai";
        cleanSource.variantId = "org.imhentai";
        cleanSource.sourceId = "org.imhentai";
        cleanSource.environment = "jsc";
      } else if (sourceKey === "org.novelfull") {
        cleanSource.id = "org.novelfull";
        cleanSource.name = "NovelFull";
        cleanSource.version = 1.9;
        cleanSource.website = "https://novelfull.com";
        cleanSource.rating = 0;
        cleanSource.thumbnail = "novelfull.png";
        cleanSource.languages = ["en"];
        cleanSource.path = "org.novelfull";
        cleanSource.variantId = "org.novelfull";
        cleanSource.sourceId = "org.novelfull";
        cleanSource.environment = "jsc";
      } else {
        cleanSource.id = "moe.atsu";
        cleanSource.name = "Atsumaru";
        cleanSource.version = 2.7;
        cleanSource.website = "https://atsu.moe";
        cleanSource.rating = 1;
        cleanSource.thumbnail = "Atsu.png";
        cleanSource.languages = ["en"];
        cleanSource.path = "moe.atsu";
        cleanSource.variantId = "moe.atsu";
        cleanSource.sourceId = "moe.atsu";
        cleanSource.environment = "jsc";
      }

      delete cleanSource.minSupportedAppVersion;
      return cleanSource;
    });
  }
  const serialized = JSON.stringify(data, null, 2);
  fs.writeFileSync(sourcesJsonPath, serialized + "\n");
  fs.writeFileSync(rootSourcesJsonPath, serialized + "\n");
}
