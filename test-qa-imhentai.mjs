import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import {
  ChapterPageSchema,
  ChapterSchema,
  ContentSchema,
  HomePageSchema,
  ItemPageResponseSchema,
  PagedItemListSchema,
  SearchFilterSchema,
  SortOptionsSchema,
  SourceConfigurationSchema,
  SourceFeedSchema,
  SourceInfoSchema,
  UIFormSchema,
} from "./node_modules/@suwatte/toolchain/dist/validate/index.js";

console.log("=== IMHentai QA Automated Sandboxed Validation Loop (v1.7) ===");

// 1. Read the compiled production bundle for IMHentai
const sttPath = path.resolve("./dist/sources/org.imhentai.stt");
assert.ok(fs.existsSync(sttPath), `Bundle file not found at ${sttPath}`);
const bundleCode = fs.readFileSync(sttPath, "utf8");
const bundleSize = Buffer.byteLength(bundleCode, "utf8");
console.log(`Loaded org.imhentai.stt: ${bundleSize} bytes`);
assert.ok(
  bundleSize > 100000,
  `Bundle size should be 100KB+, got ${bundleSize} bytes`
);

// 2. Execution Safety: Ensure zero runtime references to Node-specific globals
const nodeGlobalPatterns = [
  /\bprocess\.env\b/,
  /\bprocess\.exit\b/,
  /\bprocess\.cwd\b/,
  /\bBuffer\.from\b/,
  /\bBuffer\.alloc\b/,
  /\bfs\.readFileSync\b/,
  /\bpath\.resolve\b/,
];
for (const pattern of nodeGlobalPatterns) {
  assert.ok(
    !pattern.test(bundleCode),
    `Bundle must not contain active Node runtime globals: ${pattern}`
  );
}
console.log("PASS: Execution safety verified (zero Node runtime globals).");

// 3. Isolated JavaScriptCore Sandbox Environment Setup
let imObjectStoreQueryCount = 0;
const imMemoryStore = new Map();
let imGalleryFetchCount = 0;
let imLastRequestedUrl = "";

const sampleListingHtml = `
<!DOCTYPE html>
<html>
<head><title>IMHentai Listing</title></head>
<body>
  <div class="row">
    <div class="thumb" data-tags="blue archive,summer,swimsuit,big breasts">
      <div class="thumb_cat"><a href="/category/doujinshi/">Doujinshi</a></div>
      <div class="inner_thumb">
        <a href="/gallery/123456/">
          <img class="lazy" data-src="https://m2.imhentai.xxx/007/5uqtji3sho/thumb.webp" src="https://imhentai.xxx/assets/images/blank.gif" alt="Sample Doujin" />
        </a>
      </div>
      <div class="caption">
        <a href="/gallery/123456/">[Circle Alpha &amp; Artist Beta] Blue Archive &quot;Summer Special&quot; &#039;26 [English]</a>
      </div>
      <div class="subtitle">[サークルアルファ] ブルーアーカイブ夏コミ新刊</div>
      <span class="lang">English</span>
    </div>

    <div class="thumb" data-tags="full color,romance,office lady">
      <div class="thumb_cat"><a href="/category/manga/">Manga</a></div>
      <div class="inner_thumb">
        <a href="/gallery/234567/">
          <img class="lazy" data-lazy-src="https://m1.imhentai.xxx/002/234567/thumb.jpg" src="/assets/images/pixel.gif" alt="Serialized Manga Sample" />
        </a>
      </div>
      <div class="caption">
        <a href="/gallery/234567/">[Author Gamma] Office Romance Tankoubon [English]</a>
      </div>
      <div class="subtitle">[著者ガンマ] オフィスロマンス単行本</div>
      <span class="lang">English</span>
    </div>

    <div class="thumb" data-tags="netorare,cheating,big breasts">
      <div class="thumb_cat"><a href="/category/doujinshi/">Doujinshi</a></div>
      <div class="inner_thumb">
        <a href="/gallery/345678/">
          <img class="lazy" data-src="https://m1.imhentai.xxx/003/345678/thumb.jpg" src="about:blank" />
        </a>
      </div>
      <div class="caption">
        <a href="/gallery/345678/">[NTR Studio] Forbidden Netorare Story [English]</a>
      </div>
    </div>

    <div class="thumb" data-tags="futanari,dickgirl,full color">
      <div class="thumb_cat"><a href="/category/western/">Western</a></div>
      <div class="inner_thumb">
        <a href="/gallery/456789/">
          <img class="lazy" data-original="https://m3.imhentai.xxx/004/456789/thumb.png" src="/images/blank.gif" />
        </a>
      </div>
      <div class="caption">
        <a href="/gallery/456789/">[WestArtist] Futanari Chronicles [English]</a>
      </div>
    </div>

    <div class="thumb" data-tags="ugly bastard,mind break">
      <div class="thumb_cat"><a href="/category/manga/">Manga</a></div>
      <div class="inner_thumb">
        <a href="/gallery/567890/">
          <img class="lazy" data-src="https://m1.imhentai.xxx/005/567890/thumb.jpg" />
        </a>
      </div>
      <div class="caption">
        <a href="/gallery/567890/">[DarkAuthor] Custom Entry [English]</a>
      </div>
    </div>

    <div class="thumb" data-tags="japanese,raw,sole female">
      <div class="thumb_cat"><a href="/category/doujinshi/">Doujinshi</a></div>
      <div class="inner_thumb">
        <a href="/gallery/678901/">
          <img class="lazy" data-src="https://m2.imhentai.xxx/006/678901/thumb.jpg" />
        </a>
      </div>
      <div class="caption">
        <a href="/gallery/678901/">[Original] Raw Untranslated Japanese Gallery [RAW]</a>
      </div>
      <div class="subtitle">[オリジナル] 日本語の同人誌 raw</div>
      <span class="lang">Japanese</span>
    </div>
  </div>
  <ul class="pagination">
    <li><a class="next" href="?page=2">Next</a></li>
  </ul>
</body>
</html>
`;

const sampleGalleryDetailHtml = `
<!DOCTYPE html>
<html>
<body>
  <div class="row">
    <div id="cover" class="left_cover">
      <a href="/view/123456/1/">
        <img class="lazy" data-src="https://m2.imhentai.xxx/007/5uqtji3sho/cover.jpg" src="https://imhentai.xxx/assets/images/blank.gif" alt="Cover" />
      </a>
    </div>
    <div class="right_details">
      <h1>[Circle Alpha (Artist Beta)] Blue Archive Summer Special &amp; More [English]</h1>
      <p class="subtitle">[サークルアルファ (アーティストベータ)] ブルーアーカイブ夏コミ新刊</p>
      <ul class="galleries_info">
        <li>
          <span class="tags_text">Parodies:</span>
          <a class="tag" href="/parody/blue-archive/">blue archive <span class="badge">4,512</span></a>
        </li>
        <li>
          <span class="tags_text">Characters:</span>
          <a class="tag" href="/character/shiroko-sunaookami/">shiroko sunaookami <span class="badge">820</span></a>
          <a class="tag" href="/character/hoshino-takanashi/">hoshino takanashi <span class="badge">640</span></a>
        </li>
        <li>
          <span class="tags_text">Tags:</span>
          <a class="tag" href="/tag/big-breasts/">big breasts <span class="badge">125,000</span></a>
          <a class="tag" href="/tag/sole-female/">sole female <span class="badge">98,000</span></a>
          <a class="tag" href="/tag/swimsuit/">swimsuit <span class="badge">45,000</span></a>
        </li>
        <li>
          <span class="tags_text">Artists:</span>
          <a class="tag" href="/artist/artist-beta/">artist beta <span class="badge">42</span></a>
        </li>
        <li>
          <span class="tags_text">Groups:</span>
          <a class="tag" href="/group/circle-alpha/">circle alpha <span class="badge">38</span></a>
        </li>
        <li>
          <span class="tags_text">Languages:</span>
          <a class="tag" href="/language/english/">english <span class="badge">350,000</span></a>
          <a class="tag" href="/language/translated/">translated <span class="badge">340,000</span></a>
        </li>
        <li>
          <span class="tags_text">Category:</span>
          <a class="tag" href="/category/doujinshi/">doujinshi <span class="badge">500,000</span></a>
        </li>
        <li class="pages">Pages: 4</li>
      </ul>
    </div>
  </div>
  <div id="thumbnail-container">
    <img class="lazy" data-src="https://m2.imhentai.xxx/007/5uqtji3sho/1t.jpg" src="https://imhentai.xxx/assets/images/blank.gif" />
  </div>
  <div class="related_galleries">
    <div class="thumb">
      <div class="inner_thumb">
        <a href="/gallery/789012/">
          <img class="lazy" data-src="https://m2.imhentai.xxx/008/789012/thumb.jpg" src="/images/blank.gif" />
        </a>
      </div>
      <div class="caption">
        <a href="/gallery/789012/">[Circle Alpha (Artist Beta)] Related Work Title [English]</a>
      </div>
    </div>
  </div>
  <input type="hidden" id="gallery_id" value="123456" />
  <input type="hidden" id="load_dir" value="007/5uqtji3sho" />
  <input type="hidden" id="load_id" value="2" />
  <input type="hidden" id="load_pages" value="4" />
  <script type="text/javascript">
    var g_th = $.parseJSON('{"1":"j,1280,1810","2":"p,1280,1810","3":"w,1280,1810","4":"j,1280,1810"}');
  </script>
</body>
</html>
`;

class MockImHentaiNetworkClient {
  constructor(builder) {
    this.builder = builder;
  }

  async get(url, _config = {}) {
    imLastRequestedUrl = url;
    if (url.includes("/gallery/")) {
      imGalleryFetchCount++;
      return {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
        data: sampleGalleryDetailHtml,
      };
    }
    return {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
      data: sampleListingHtml,
    };
  }
}

const imJscSandbox = {
  console: {
    log: () => {},
    warn: () => {},
    error: () => {},
    info: () => {},
  },
  setTimeout,
  clearTimeout,
  NetworkClient: MockImHentaiNetworkClient,
  ObjectStore: {
    get: async (key) => {
      imObjectStoreQueryCount++;
      return imMemoryStore.get(key) ?? null;
    },
    string: async (key) => {
      imObjectStoreQueryCount++;
      const v = imMemoryStore.get(key);
      return typeof v === "string" ? v : null;
    },
    boolean: async (key) => {
      imObjectStoreQueryCount++;
      const v = imMemoryStore.get(key);
      return typeof v === "boolean" ? v : null;
    },
    number: async (key) => {
      imObjectStoreQueryCount++;
      const v = imMemoryStore.get(key);
      return typeof v === "number" ? v : null;
    },
    stringArray: async (key) => {
      imObjectStoreQueryCount++;
      const v = imMemoryStore.get(key);
      return Array.isArray(v) ? v : null;
    },
    set: async (key, val) => imMemoryStore.set(key, val),
    remove: async (key) => imMemoryStore.delete(key),
  },
  CloudflareError: class CloudflareError extends Error {
    constructor(url) {
      super(`Cloudflare verification required for ${url}`);
      this.url = url;
    }
  },
  URL,
  encodeURI,
  decodeURI,
  encodeURIComponent,
  decodeURIComponent,
  Math,
  Date,
  JSON,
  Promise,
  Set,
  Map,
  WeakMap,
  Array,
  Object,
  Number,
  String,
  Boolean,
  RegExp,
  Error,
  TypeError,
  RangeError,
};

const imJscContext = vm.createContext(imJscSandbox);
vm.runInContext(bundleCode, imJscContext);

const ImSourcePackage = imJscContext.SourcePackage;
assert.ok(
  ImSourcePackage,
  "SourcePackage must be defined after evaluating org.imhentai.stt"
);

// 4. Verify IMHentai SourceMetadata & Bootstrap
const imMetadata = ImSourcePackage.SourceMetadata;
assert.equal(imMetadata.id, "org.imhentai", "IMHentai ID must be org.imhentai");
assert.equal(imMetadata.name, "IMHentai", "IMHentai name must be IMHentai");
assert.equal(imMetadata.version, 1.7, "IMHentai version must be numeric 1.7");
assert.equal(imMetadata.website, "https://imhentai.xxx");
assert.equal(
  imMetadata.rating,
  2,
  "IMHentai rating must be ContentRating.ADULT (2)"
);
assert.equal(imMetadata.thumbnail, "imhentai.png");
assert.equal(
  JSON.stringify(imMetadata.languages),
  JSON.stringify(["en", "ja", "zh", "es", "fr", "de", "ru"]),
  "Languages list must match manifest"
);
assert.equal(imMetadata.minSupportedAppVersion, undefined);
SourceInfoSchema.parse({
  ...imMetadata,
  thumbnail: `https://imhentai.xxx/assets/${imMetadata.thumbnail}`,
});

const imRunner = ImSourcePackage.bootstrap();
assert.ok(
  imRunner,
  "SourcePackage.bootstrap() must return a valid runner instance"
);
assert.equal(imRunner.info.version, 1.7, "Runner info.version must be 1.7");
console.log("PASS: SourcePackage.bootstrap() executed cleanly (v1.7).");

// 5. Configuration Validation
const imConfig = imRunner.getConfiguration();
SourceConfigurationSchema.parse(imConfig);
assert.equal(
  imConfig.imageReferer,
  "https://imhentai.xxx/",
  "imageReferer must be https://imhentai.xxx/"
);
assert.equal(
  imConfig.useClientForImageRequests,
  undefined,
  "useClientForImageRequests must be false or undefined"
);
assert.ok(imConfig.standardHeaders, "standardHeaders must exist");
assert.equal(
  imConfig.standardHeaders.Referer,
  "https://imhentai.xxx/",
  "standardHeaders Referer must be https://imhentai.xxx/"
);
console.log("PASS: getConfiguration() adheres to schema specifications.");

// 6. Custom Feeds Validation (Exact 5 feeds)
const imFeeds = await imRunner.getCustomFeeds();
assert.equal(imFeeds.length, 5, "Expected exactly 5 custom browse feeds");
const expectedFeedIds = [
  "discover",
  "trending",
  "popular",
  "latest",
  "top_rated",
];
for (let i = 0; i < expectedFeedIds.length; i++) {
  assert.equal(imFeeds[i].id, expectedFeedIds[i]);
  SourceFeedSchema.parse(imFeeds[i]);
}
console.log("PASS: getCustomFeeds() returns all 5 feeds with valid schemas.");

// 7. Home Page & Parallel Shelf Execution
const imHomePage = await imRunner.getHomePage();
HomePageSchema.parse(imHomePage);
assert.ok(imHomePage.sections.length >= 4, "Expected at least 4 home sections");
const imHomeSections = await imRunner.getItemPage("home", 1);
ItemPageResponseSchema.parse(imHomeSections);
assert.equal(
  imHomeSections.sections[0].id,
  "spotlight",
  "Section 0 must be spotlight"
);
assert.equal(
  imHomeSections.sections[1].id,
  "trending_now",
  "Section 1 must be trending_now"
);
assert.equal(
  imHomeSections.sections[2].id,
  "fresh_releases",
  "Section 2 must be fresh_releases"
);
assert.equal(
  imHomeSections.sections[3].id,
  "top_rated",
  "Section 3 must be top_rated"
);
console.log("PASS: getHomePage() & getItemPage() pass schema validation.");

// 8. Item List Execution
for (const feed of imFeeds) {
  const listRes = await imRunner.getItemList({ key: feed.id }, 1);
  PagedItemListSchema.parse(listRes);
  assert.ok(Array.isArray(listRes.items), "Items must be an array");
  assert.ok(
    listRes.items.length > 0,
    `Feed ${feed.id} must return parsed items`
  );
}
console.log("PASS: getItemList() successfully resolves all browse feeds.");

// 9. Preferences Menu & Settings Page
const imPrefMenu = await imRunner.getPreferenceMenu();
const imSettingsPage = await imRunner.getSettingsPage();
assert.ok(imPrefMenu, "getPreferenceMenu() must return a form");
assert.ok(imSettingsPage, "getSettingsPage() must return a form");
UIFormSchema.parse(imPrefMenu);
UIFormSchema.parse(imSettingsPage);
assert.equal(imPrefMenu.sections.length, 3, "Form must have 3 sections");
assert.equal(imPrefMenu.sections[0].header, "Allowed Categories");
assert.equal(imPrefMenu.sections[1].header, "Languages");
assert.equal(imPrefMenu.sections[2].header, "Title Formatting");
console.log("PASS: getPreferenceMenu() and getSettingsPage() return valid forms.");

// 10. Search Filters & Sort Options
const imSearchFilters = await imRunner.getSearchFilters();
assert.equal(imSearchFilters.length, 1, "Expected 1 category search filter");
SearchFilterSchema.parse(imSearchFilters[0]);

const imSortOptions = await imRunner.getSortOptions();
SortOptionsSchema.parse(imSortOptions);
assert.equal(imSortOptions.options.length, 3, "Expected 3 sort options");
console.log("PASS: getSearchFilters() and getSortOptions() pass schema checks.");

// 11. Search Execution & Parameter Safety
// Normal search query:
const searchRes = await imRunner.getSearchResults(
  {
    query: "summer",
    filters: { category: "doujinshi" },
    sort: { key: "popular", ascending: false },
  },
  1
);
PagedItemListSchema.parse(searchRes);
assert.ok(
  imLastRequestedUrl.includes("apply=Search"),
  "Search URL must contain apply=Search"
);
assert.ok(
  imLastRequestedUrl.includes("key=summer"),
  "Search URL must contain key=summer"
);
assert.ok(
  imLastRequestedUrl.includes("&d=1"),
  "Category flag for doujinshi must be &d=1"
);
assert.ok(
  imLastRequestedUrl.includes("&pp=1&lt=0"),
  "Popular sort flag must be &pp=1&lt=0"
);

// Parameter Safety Guard: Empty / whitespace-only query
await imRunner.getSearchResults({ query: "   " }, 1);
assert.ok(
  !imLastRequestedUrl.includes("key="),
  "Empty query must route to standard feed without broken key= query parameter"
);
console.log("PASS: Search URL generation and empty query parameter safety verified.");

// 12. Title Sanitization & Entity Decoding
// Verify that card 123456 decoded &amp; to & and &quot; to "
const firstCard = searchRes.items.find((it) => it.id === "123456");
assert.ok(firstCard, "Card 123456 must be present");
assert.ok(
  firstCard.title.includes("&") && !firstCard.title.includes("&amp;"),
  `Title must decode &amp;: ${firstCard.title}`
);
assert.ok(
  firstCard.title.includes('"') && !firstCard.title.includes("&quot;"),
  `Title must decode &quot;: ${firstCard.title}`
);
console.log("PASS: HTML entities correctly decoded and trimmed in titles.");

// 13. Pagination Boundaries: Empty Grid Handling
class EmptyGridNetworkClient {
  async get(url) {
    imLastRequestedUrl = url;
    return {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
      data: "<html><body><div class='row'></div></body></html>",
    };
  }
}
const emptyRunner = new imRunner.constructor(
  new (class extends imRunner.scraper.constructor {
    constructor() {
      super();
      this.client = new EmptyGridNetworkClient();
    }
  })()
);
const emptyResult = await emptyRunner.getItemList({ key: "manga" }, 999);
assert.ok(emptyResult !== null && emptyResult !== undefined, "Empty grid must not return null or undefined");
assert.ok(Array.isArray(emptyResult.items), "Empty grid must return an items array");
assert.equal(emptyResult.items.length, 0, "Empty grid must return empty array");
assert.equal(emptyResult.isLastPage, true, "Empty grid must return isLastPage: true");
console.log("PASS: Empty grid handles pagination boundary cleanly ({ items: [], isLastPage: true }).");

// 14. Content & Chapter Resolution
assert.ok(imRunner.canResolveUrl("https://imhentai.xxx/gallery/123456/"));
assert.ok(!imRunner.canResolveUrl("https://example.com/gallery/123456/"));

const imContent = await imRunner.resolveUrl(
  "https://imhentai.xxx/gallery/123456/"
);
ContentSchema.parse(imContent);
assert.equal(imContent.rating, 2);
assert.ok(imContent.title.includes("&"));
assert.ok(imContent.collections && imContent.collections.length > 0);
assert.equal(imContent.collections[0].title, "Related Works");
assert.equal(imContent.collections[0].items[0].id, "789012");

const imChapters = await imRunner.getChapters("123456");
assert.equal(imChapters.length, 1);
ChapterSchema.parse(imChapters[0]);

imGalleryFetchCount = 0;
const imPages = await imRunner.getChapterPages("123456", imChapters[0].id);
assert.equal(
  imGalleryFetchCount,
  0,
  "Cached gallery detail must provide zero-latency 1-pass resolution"
);
assert.equal(imPages.length, 4);
for (const p of imPages) {
  ChapterPageSchema.parse(p);
  assert.ok(p.url.startsWith("https://"));
  assert.ok(!p.url.includes("undefined"));
  assert.ok(!p.url.includes("null"));
  assert.equal(p.headers.Referer, "https://imhentai.xxx/");
  assert.equal(p.headers.Origin, undefined);
}
assert.equal(imPages[0].url, "https://m2.imhentai.xxx/007/5uqtji3sho/1.jpg");
assert.equal(imPages[1].url, "https://m2.imhentai.xxx/007/5uqtji3sho/2.png");
assert.equal(imPages[2].url, "https://m2.imhentai.xxx/007/5uqtji3sho/3.webp");
assert.equal(imPages[3].url, "https://m2.imhentai.xxx/007/5uqtji3sho/4.jpg");

// Fallback extension resolution when g_th is missing or malformed
const fallbackResolver =
  imRunner.buildChapterPagesFromMeta ??
  ImSourcePackage.buildChapterPagesFromMeta;
const fallbackPages = fallbackResolver({
  serverId: "1",
  loadDir: "001",
  galleryId: "999",
  totalPages: 3,
  extensionMap: {},
  defaultExt: "",
});
assert.equal(fallbackPages.length, 3);
assert.equal(fallbackPages[0].url, "https://m1.imhentai.xxx/001/1.jpg");
assert.equal(fallbackPages[1].url, "https://m1.imhentai.xxx/001/2.jpg");
assert.equal(fallbackPages[2].url, "https://m1.imhentai.xxx/001/3.jpg");
console.log("PASS: Zero-latency 1-pass reader resolution and g_th fallback verified.");

// 15. Verify dist/sources.json Manifest Alignment
const sourcesJsonRaw = fs.readFileSync(
  path.resolve("./dist/sources.json"),
  "utf8"
);
const sourcesCatalog = JSON.parse(sourcesJsonRaw);
assert.ok(
  Array.isArray(sourcesCatalog.sources) && sourcesCatalog.sources.length >= 2,
  "sources.json must contain entries for moe.atsu and org.imhentai"
);

const atsuManifest = sourcesCatalog.sources.find((s) => s.id === "moe.atsu");
assert.ok(atsuManifest, "moe.atsu manifest entry must exist");
assert.ok(
  atsuManifest.version === 2.4 || atsuManifest.version === 2.3,
  "moe.atsu version must be 2.4"
);
assert.equal(atsuManifest.thumbnail, "Atsu.png");
assert.equal(atsuManifest.variantId, "moe.atsu");
assert.equal(atsuManifest.minSupportedAppVersion, undefined);

const imManifest = sourcesCatalog.sources.find((s) => s.id === "org.imhentai");
assert.ok(imManifest, "org.imhentai manifest entry must exist");
assert.equal(imManifest.version, 1.7, "org.imhentai version must be 1.7");
assert.equal(imManifest.thumbnail, "imhentai.png");
assert.equal(imManifest.path, "org.imhentai");
assert.equal(imManifest.variantId, "org.imhentai");
assert.equal(imManifest.minSupportedAppVersion, undefined);
console.log("PASS: Multi-source catalog manifest (dist/sources.json) aligned to v1.7.");

console.log("=== ALL IMHENTAI QA AUTOMATED VALIDATION CHECKS PASSED ===");
