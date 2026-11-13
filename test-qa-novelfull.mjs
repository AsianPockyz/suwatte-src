import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import vm from "node:vm";
import * as cheerio from "cheerio";
import {
  ChapterSchema,
  ContentSchema,
  HomePageSchema,
  ItemPageResponseSchema,
  PagedItemListSchema,
  SearchFilterSchema,
  SortOptionsSchema,
  SourceChapterTextSchema,
  SourceConfigurationSchema,
  SourceFeedSchema,
  SourceInfoSchema,
  UIFormSchema,
} from "./node_modules/@suwatte/toolchain/dist/validate/index.js";

console.log("=== NovelFull QA Automated Sandboxed Validation Loop (v1.8) ===");

// 1. Read the compiled production bundle for NovelFull
const sttPath = path.resolve("./dist/sources/org.novelfull.stt");
assert.ok(fs.existsSync(sttPath), `Bundle file not found at ${sttPath}`);
const bundleCode = fs.readFileSync(sttPath, "utf8");
const bundleSize = Buffer.byteLength(bundleCode, "utf8");
console.log(`Loaded org.novelfull.stt: ${bundleSize} bytes`);
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
let nfObjectStoreQueryCount = 0;
const nfMemoryStore = new Map();
let nfAjaxFetchCount = 0;
let nfDetailFetchCount = 0;
let nfLastRequestedUrl = "";

const sampleHomeAndListingHtml = `
<!DOCTYPE html>
<html>
<head><title>NovelFull - Read Novel Online</title></head>
<body>
  <div id="intro-index" class="index-intro">
    <div class="item">
      <a href="/omniscient-readers-viewpoint.html" title="Omniscient Reader&rsquo;s Viewpoint">
        <img data-src="/uploads/thumbs/orv-cover.jpg" src="/images/blank.gif" alt="Omniscient Reader's Viewpoint" />
      </a>
      <div class="caption">
        <h3><a href="/omniscient-readers-viewpoint.html">Omniscient Reader&rsquo;s Viewpoint</a></h3>
      </div>
    </div>
    <div class="item">
      <a href="/lord-of-the-mysteries.html" title="Lord of the Mysteries">
        <img data-lazy-src="uploads/thumbs/lotm-cover.jpg" src="https://novelfull.com/web/images/pixel.gif" alt="Lord of the Mysteries" />
      </a>
      <div class="caption">
        <h3><a href="/lord-of-the-mysteries.html">Lord of the Mysteries</a></h3>
      </div>
    </div>
  </div>

  <div class="col-novel-main">
    <div class="list-novel list-truyen">
      <div class="row" data-genres="Action,Adventure,Fantasy,Martial Arts">
        <div class="col-xs-3">
          <div class="book">
            <img data-src="/uploads/thumbs/martial-peak.jpg" src="/images/blank.gif" alt="Martial Peak" />
          </div>
        </div>
        <div class="col-xs-7">
          <div>
            <span class="glyphicon glyphicon-book"></span>
            <h3 class="truyen-title"><a href="/martial-peak.html" title="Martial Peak">Martial Peak</a></h3>
            <span class="label-title label-hot"></span>
            <span class="label-title label-full"></span>
            <span class="author"><span class="glyphicon glyphicon-pencil"></span> Momo</span>
          </div>
        </div>
        <div class="col-xs-2 text-info">
          <div><a href="/martial-peak/chapter-6009.html"><span class="chr-text">Chapter 6009</span></a></div>
        </div>
      </div>

      <div class="row" data-genres="Action,Fantasy,Xuanhuan">
        <div class="col-xs-3">
          <div class="book">
            <img data-original="//novelfull.com/uploads/thumbs/shadow-slave.jpg" src="about:blank" alt="Shadow Slave" />
          </div>
        </div>
        <div class="col-xs-7">
          <div>
            <h3 class="truyen-title"><a href="/shadow-slave.html">Shadow Slave &amp; Nightmares</a></h3>
            <span class="author">Guiltythree</span>
          </div>
        </div>
        <div class="col-xs-2 text-info">
          <div><a href="/shadow-slave/chapter-1850.html"><span class="chr-text">Chapter 1850</span></a></div>
        </div>
      </div>

      <div class="row" data-genres="Ecchi,Harem,Mature">
        <div class="col-xs-3">
          <div class="book">
            <img src="https://novelfull.com/uploads/thumbs/dual-harem-system.jpg" alt="Dual Harem System" />
          </div>
        </div>
        <div class="col-xs-7">
          <div>
            <h3 class="truyen-title"><a href="/dual-harem-system.html">Dual Harem System</a></h3>
            <span class="author">HaremKing</span>
          </div>
        </div>
        <div class="col-xs-2 text-info">
          <div><a href="/dual-harem-system/chapter-100.html"><span class="chr-text">Chapter 100</span></a></div>
        </div>
      </div>

      <div class="row" data-genres="Fantasy,Adventure">
        <div class="col-xs-3">
          <div class="book">
            <img data-src="/uploads/thumbs/unreadable-mtl-trash.jpg" />
          </div>
        </div>
        <div class="col-xs-7">
          <div>
            <h3 class="truyen-title"><a href="/unreadable-mtl-trash.html">Unreadable MTL Trash</a></h3>
            <span class="author">AutoBot</span>
          </div>
        </div>
      </div>
    </div>
  </div>

  <div id="truyen-slide" class="completed-novel">
    <div class="item">
      <a href="/solo-leveling.html">
        <img data-src="/uploads/thumbs/solo-leveling.jpg" src="/images/blank.gif" />
        <div class="caption"><h3>Solo Leveling</h3><small>Full - 270 Chapters</small></div>
      </a>
    </div>
  </div>

  <ul class="pagination">
    <li class="active"><a href="?page=1">1</a></li>
    <li class="next"><a href="?page=2">Next</a></li>
  </ul>
</body>
</html>
`;

const sampleNovelDetailHtml = `
<!DOCTYPE html>
<html>
<body>
  <div class="col-info-desc">
    <div class="info-holder">
      <div class="books">
        <div class="book">
          <img data-src="/uploads/thumbs/martial-peak-highres.jpg" src="/images/blank.gif" alt="Martial Peak" />
        </div>
        <div class="desc">
          <h3 class="title">Martial Peak</h3>
        </div>
      </div>
      <div class="info">
        <div><h3>Author:</h3> <a href="/author/Momo">Momo</a></div>
        <div><h3>Alternative names:</h3> Wu Lian Dian Feng, 武炼巅峰</div>
        <div><h3>Genre:</h3> <a href="/genre/Action">Action</a>, <a href="/genre/Adventure">Adventure</a>, <a href="/genre/Martial+Arts">Martial Arts</a>, <a href="/genre/Xuanhuan">Xuanhuan</a></div>
        <div><h3>Source:</h3> Qidian</div>
        <div><h3>Status:</h3> <a href="/status/Completed">Completed</a></div>
      </div>
    </div>
    <div class="desc">
      <div id="rating" data-novel-id="45821"></div>
      <div class="small"><em>Rating: <strong><span itemprop="ratingValue">8.9</span></strong>/10</em></div>
      <div class="desc-text" itemprop="description">
        <p>The journey to the martial peak is a lonely, solitary and long one.</p>
        <p>In the face of adversity, you must survive and remain unyielding.</p>
      </div>
    </div>
  </div>
  <ul class="list-chapter">
    <li><a href="/martial-peak/chapter-1-prologue.html"><span class="chapter-text">Chapter 1: Prologue</span></a></li>
    <li><a href="/martial-peak/chapter-2-sweeping-the-floors.html"><span class="chapter-text">Chapter 2: Sweeping the Floors</span></a></li>
  </ul>
</body>
</html>
`;

const sampleAjaxChaptersHtml = `
<select class="chapter_jump form-control">
  <option value="/martial-peak/chapter-1-prologue.html">Chapter 1: Prologue</option>
  <option value="/martial-peak/chapter-2-sweeping-the-floors.html">Chapter 2: Sweeping the Floors</option>
  <option value="/martial-peak/volume-2-chapter-3-black-book.html">Volume 2 Chapter 3: The Mysterious Black Book</option>
</select>
`;

const sampleChapterHtml = `
<!DOCTYPE html>
<html>
<body>
  <div id="chapter-content" class="chapter-c">
    <!-- Hidden aggregator comment -->
    <script>window.evilTracker = 1;</script>
    <style>.ads { display: block; }</style>
    <iframe src="https://ads.example.com/frame"></iframe>
    <noscript>Enable JS</noscript>
    <ins class="adsbygoogle">AdSense Block</ins>
    <div class="ads ads-holder">Advertisement Banner</div>
    <div class="ads-box">Ad Box</div>
    <div id="div-gpt-ad-12345">GPT Ad</div>
    <div class="custom-ad-container">Ad Container</div>
    <div align="center">System Alert</div>
    <p>Read novel online free on NovelFull</p>
    <p>&ldquo;The journey to the martial peak is lonely,&rdquo; Yang Kai whispered&mdash;clenching his fists.&nbsp;&nbsp;</p>
    <br><br><br><br>
    <p></p>
    <p>&nbsp;</p>
    <p><Come forward.></p>
    <p>He opened the mysterious black stone pillow. [TL Note: Black Stone Pillow is an Emperor Artifact] Slowly, golden letters emerged&hellip;</p>
    <span>Bare span dialogue</span><br>Bare text after br
    <p>Visit novelfull.com for the best novel reading experience</p>
    <p>If you discover any errors ( broken links, non-standard content, etc.. ), Please let us know &lt; report chapter &gt; so we can fix it as soon as possible.</p>
    <p>Previous Chapter</p>
    <p>Next Chapter</p>
    <p>Table of Contents</p>
  </div>
</body>
</html>
`;

class MockNovelFullNetworkClient {
  constructor(builder) {
    this.builder = builder;
  }

  async get(url, _config = {}) {
    nfLastRequestedUrl = url;

    if (url.includes("/ajax-chapter-option")) {
      nfAjaxFetchCount++;
      return {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
        data: sampleAjaxChaptersHtml,
      };
    }

    if (
      url.includes("/martial-peak/chapter-") ||
      url.includes("/martial-peak/volume-")
    ) {
      return {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
        data: sampleChapterHtml,
      };
    }

    if (url.endsWith("/martial-peak.html")) {
      nfDetailFetchCount++;
      return {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
        data: sampleNovelDetailHtml,
      };
    }

    return {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
      data: sampleHomeAndListingHtml,
    };
  }
}

const nfJscSandbox = {
  console: {
    log: (...args) => console.log(...args),
    warn: () => {},
    error: () => {},
    info: () => {},
  },
  setTimeout,
  clearTimeout,
  NetworkClient: MockNovelFullNetworkClient,
  ObjectStore: {
    get: async (key) => {
      nfObjectStoreQueryCount++;
      return nfMemoryStore.get(key) ?? null;
    },
    string: async (key) => {
      nfObjectStoreQueryCount++;
      const v = nfMemoryStore.get(key);
      return typeof v === "string" ? v : null;
    },
    boolean: async (key) => {
      nfObjectStoreQueryCount++;
      const v = nfMemoryStore.get(key);
      return typeof v === "boolean" ? v : null;
    },
    number: async (key) => {
      nfObjectStoreQueryCount++;
      const v = nfMemoryStore.get(key);
      return typeof v === "number" ? v : null;
    },
    stringArray: async (key) => {
      nfObjectStoreQueryCount++;
      const v = nfMemoryStore.get(key);
      return Array.isArray(v) ? v : null;
    },
    set: async (key, val) => nfMemoryStore.set(key, val),
    remove: async (key) => nfMemoryStore.delete(key),
  },
  CloudflareError: class CloudflareError extends Error {
    constructor(url) {
      super(`Cloudflare verification required for ${url}`);
      this.resolutionURL = url;
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

const nfJscContext = vm.createContext(nfJscSandbox);
vm.runInContext(bundleCode, nfJscContext);

const NfSourcePackage = nfJscContext.SourcePackage;
assert.ok(
  NfSourcePackage,
  "SourcePackage must be defined after evaluating org.novelfull.stt"
);

// 4. Verify NovelFull SourceMetadata & Bootstrap
const nfMetadata = NfSourcePackage.SourceMetadata;
assert.equal(nfMetadata.id, "org.novelfull", "ID must be org.novelfull");
assert.equal(nfMetadata.name, "NovelFull", "Name must be NovelFull");
assert.equal(nfMetadata.version, 1.8, "Version must be numeric 1.8");
assert.equal(nfMetadata.website, "https://novelfull.com");
assert.equal(
  nfMetadata.rating,
  0,
  "Rating must be ContentRating.EVERYONE (0)"
);
assert.equal(nfMetadata.thumbnail, "novelfull.png");
assert.equal(
  JSON.stringify(nfMetadata.languages),
  JSON.stringify(["en"]),
  "Languages list must be ['en']"
);
assert.equal(nfMetadata.minSupportedAppVersion, undefined);
SourceInfoSchema.parse({
  ...nfMetadata,
  thumbnail: `https://novelfull.com/assets/${nfMetadata.thumbnail}`,
});

const nfRunner = NfSourcePackage.bootstrap();
assert.ok(
  nfRunner,
  "SourcePackage.bootstrap() must return a valid runner instance"
);
assert.equal(nfRunner.info.version, 1.8, "Runner info.version must be 1.8");
assert.equal(
  nfRunner.getChapterPages,
  undefined,
  "getChapterPages must NOT be implemented on a 100% text novel runner"
);
assert.equal(
  typeof nfRunner.getChapterText,
  "function",
  "getChapterText must be implemented"
);
console.log("PASS: SourcePackage.bootstrap() executed cleanly (v1.8).");

// 5. Configuration Validation
const nfConfig = nfRunner.getConfiguration();
SourceConfigurationSchema.parse(nfConfig);
assert.equal(nfConfig.imageReferer, "https://novelfull.com/");
assert.equal(nfConfig.cloudflareResolutionURL, "https://novelfull.com");
assert.equal(nfConfig.useClientForImageRequests, undefined);
assert.ok(nfConfig.standardHeaders, "standardHeaders must be defined");
assert.equal(nfConfig.standardHeaders.Referer, "https://novelfull.com/");
assert.equal(nfConfig.standardHeaders.Origin, "https://novelfull.com");
assert.ok(nfConfig.standardHeaders["User-Agent"].includes("Mozilla/5.0"));
console.log("PASS: getConfiguration() adheres to schema specifications.");

// 6. Custom Feeds Validation (5 browse tabs)
const nfFeeds = await nfRunner.getCustomFeeds();
assert.equal(nfFeeds.length, 5, "Expected 5 custom browse feeds");
const expectedFeeds = [
  { id: "discover", title: "Discover" },
  { id: "hot-novel", title: "Hot Novel" },
  { id: "latest-release-novel", title: "Latest Releases" },
  { id: "most-popular", title: "Most Popular" },
  { id: "completed-novel", title: "Completed Novels" },
];
for (let i = 0; i < expectedFeeds.length; i++) {
  assert.equal(nfFeeds[i].id, expectedFeeds[i].id);
  assert.equal(nfFeeds[i].title, expectedFeeds[i].title);
  SourceFeedSchema.parse(nfFeeds[i]);
}
console.log("PASS: getCustomFeeds() returns all 5 feeds with valid schemas.");

// 7. Multi-Shelf Home Dashboard Validation
const nfHomePage = await nfRunner.getHomePage();
HomePageSchema.parse(nfHomePage);
assert.equal(nfHomePage.sections.length, 5, "Expected 5 home shelves");
const nfHomeSections = await nfRunner.getItemPage("home", 1);
ItemPageResponseSchema.parse(nfHomeSections);
assert.equal(nfHomeSections.sections[0].id, "spotlight");
assert.equal(nfHomeSections.sections[1].id, "hot_novels");
assert.equal(nfHomeSections.sections[2].id, "latest_releases");
assert.equal(nfHomeSections.sections[3].id, "completed_masterpieces");
assert.equal(nfHomeSections.sections[4].id, "most_popular");
console.log(
  "PASS: getHomePage() & getItemPage() return all 5 shelves passing @suwatte/toolchain/validate."
);

// 8. Lazy-Load Thumbnail Extraction & Item List Validation
for (const feed of nfFeeds) {
  const listRes = await nfRunner.getItemList({ key: feed.id }, 1);
  PagedItemListSchema.parse(listRes);
  assert.ok(listRes.items.length > 0, `Feed ${feed.id} must return items`);
  for (const item of listRes.items) {
    assert.ok(
      item.coverImage.startsWith("https://novelfull.com/"),
      `Cover image must be normalized to https://novelfull.com/: ${item.coverImage}`
    );
    assert.ok(
      !item.coverImage.includes("blank.gif") &&
        !item.coverImage.includes("pixel.gif") &&
        !item.coverImage.includes("/images/"),
      `Cover image must not be a placeholder trap: ${item.coverImage}`
    );
  }
}
console.log(
  "PASS: Lazy-load cover extraction (data-src -> data-lazy-src -> data-original -> src) & URL normalization verified."
);

// 9. Preferences Menu & O(1) Blacklist Filtering
const nfPrefMenu = await nfRunner.getPreferenceMenu();
UIFormSchema.parse(nfPrefMenu);
assert.equal(nfPrefMenu.sections.length, 3);
assert.equal(
  nfPrefMenu.sections[0].header,
  "Reader Layout & Typography"
);
assert.equal(
  JSON.stringify(nfPrefMenu.sections[0].views.map((v) => v.toggle.props.id)),
  JSON.stringify([
    "split_dialogue",
    "normalize_spacing",
    "format_callouts",
    "smart_typography",
  ])
);
for (const toggleView of nfPrefMenu.sections[0].views) {
  assert.equal(toggleView.toggle.props.defaultValue, true);
}
assert.equal(
  nfPrefMenu.sections[1].header,
  "Sanitization & Translator Notes"
);
assert.equal(nfPrefMenu.sections[2].header, "Content Exclusions / Blacklist");

// Apply exclusions: exclude Harem genre and "mtl" keyword
await nfRunner.onFormSubmitted("novelfull_prefs", {
  sanitize_ads: true,
  format_tln: true,
  normalize_spacing: true,
  split_dialogue: true,
  format_callouts: true,
  smart_typography: true,
  excluded_genres: { include: ["Harem", "Ecchi"], exclude: [] },
  custom_blacklist: "mtl, machine translation",
});

const filteredList = await nfRunner.getItemList({ key: "hot-novel" }, 1);
PagedItemListSchema.parse(filteredList);
assert.ok(
  !filteredList.items.some((it) => it.id === "dual-harem-system"),
  "Blacklisted genre work (dual-harem-system) must be discarded"
);
assert.ok(
  !filteredList.items.some((it) => it.id === "unreadable-mtl-trash"),
  "Blacklisted keyword work (unreadable-mtl-trash) must be discarded"
);
assert.ok(
  filteredList.items.some((it) => it.id === "martial-peak"),
  "Allowed work (martial-peak) must remain"
);
console.log(
  "PASS: O(1) Set lookup blacklist filters out excluded genres, titles, and URL slugs."
);

// 10. Search Filters, Sort Options & Search Querying
const nfFilters = await nfRunner.getSearchFilters();
assert.equal(nfFilters.length, 3, "Expected 3 search filters (genres, status, sort)");
for (const f of nfFilters) {
  SearchFilterSchema.parse(f);
}
const nfSortOpts = await nfRunner.getSortOptions();
SortOptionsSchema.parse(nfSortOpts);

const searchRes = await nfRunner.getSearchResults(
  { query: "Martial Peak" },
  1
);
PagedItemListSchema.parse(searchRes);
assert.equal(
  nfLastRequestedUrl,
  "https://novelfull.com/search?keyword=Martial%20Peak&page=1"
);
console.log("PASS: Search querying & filter schemas verified.");

// 11. Content Details, Deep Linking & 1-Pass AJAX Chapter Loading
assert.equal(
  nfRunner.canResolveUrl("https://novelfull.com/martial-peak.html"),
  true
);
assert.equal(
  nfRunner.canResolveUrl("https://novelfull.net/martial-peak.html"),
  true
);
assert.equal(
  nfRunner.canResolveUrl(
    "https://novelfull.com/martial-peak/chapter-1-prologue.html"
  ),
  true
);
assert.equal(
  nfRunner.canResolveUrl("https://novelfull.com/hot-novel"),
  false
);

nfDetailFetchCount = 0;
nfAjaxFetchCount = 0;

const nfContent = await nfRunner.getContent("martial-peak");
ContentSchema.parse(nfContent);
assert.equal(nfContent.title, "Martial Peak");
assert.equal(nfContent.contentType, 4, "Must be ContentType.NOVEL (4)");
assert.equal(nfContent.status, 2, "Must be ContentStatus.COMPLETED (2)");
assert.equal(
  nfContent.coverImage,
  "https://novelfull.com/uploads/thumbs/martial-peak-highres.jpg"
);
assert.equal(nfContent.credits?.[0]?.name, "Momo");
assert.equal(nfDetailFetchCount, 1);

const nfChapters = await nfRunner.getChapters("martial-peak");
assert.equal(
  nfDetailFetchCount,
  1,
  "getChapters must reuse cached novel detail to get data-novel-id without re-fetching detail HTML"
);
assert.equal(
  nfAjaxFetchCount,
  1,
  "getChapters must issue 1-pass AJAX request to /ajax-chapter-option?novelId=45821"
);
assert.equal(
  nfLastRequestedUrl,
  "https://novelfull.com/ajax-chapter-option?novelId=45821"
);
assert.equal(nfChapters.length, 3, "Expected 3 chapters from AJAX <option> list");
assert.ok(nfChapters.length > 0, "Chapters length must be > 0");
if (nfChapters[0].number < nfChapters[nfChapters.length - 1].number) {
  throw new Error("Chapters array is sorted ascending instead of descending!");
}
assert.ok(
  nfChapters[0].number >= nfChapters[nfChapters.length - 1].number,
  "Chapters array must be sorted descending"
);
assert.equal(nfChapters[0].index, 0, "First chapter index must be 0");
for (const ch of nfChapters) {
  ChapterSchema.parse(ch);
}
assert.equal(nfChapters[0].id, "volume-2-chapter-3-black-book");
assert.equal(nfChapters[0].number, 3);
assert.equal(nfChapters[0].volume, 2);
assert.equal(nfChapters[2].id, "chapter-1-prologue");
assert.equal(nfChapters[2].number, 1);
console.log(
  "PASS: 1-pass AJAX chapter resolution (/ajax-chapter-option?novelId=45821) verified."
);

// 11b. Verify Fallback to On-Page .list-chapter when AJAX fails or novelId is missing, and empty result handling
class FallbackAndEmptyNetworkClient {
  async get(url) {
    if (url.includes("/ajax-chapter-option")) {
      throw new Error("Simulated AJAX network failure");
    }
    if (url.endsWith("/fallback-novel.html")) {
      return {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
        data: sampleNovelDetailHtml.replace('data-novel-id="45821"', ""),
      };
    }
    return {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
      data: "<html><body><div class='col-novel-main'></div></body></html>",
    };
  }
}

const fallbackRunner = new nfRunner.constructor(
  new (class extends nfRunner.scraper.constructor {
    constructor() {
      super(new FallbackAndEmptyNetworkClient());
    }
  })()
);

const fallbackChapters = await fallbackRunner.getChapters("fallback-novel");
assert.equal(
  fallbackChapters.length,
  2,
  "Fallback to on-page .list-chapter must return 2 chapters"
);
assert.ok(fallbackChapters.length > 0, "Chapters length must be > 0");
if (fallbackChapters[0].number < fallbackChapters[fallbackChapters.length - 1].number) {
  throw new Error("Chapters array is sorted ascending instead of descending!");
}
assert.ok(
  fallbackChapters[0].number >= fallbackChapters[fallbackChapters.length - 1].number,
  "Chapters array must be sorted descending"
);
assert.equal(fallbackChapters[0].index, 0, "First chapter index must be 0");
ChapterSchema.parse(fallbackChapters[0]);
assert.equal(fallbackChapters[0].id, "chapter-2-sweeping-the-floors");
assert.equal(fallbackChapters[0].number, 2);
assert.equal(fallbackChapters[1].id, "chapter-1-prologue");
assert.equal(fallbackChapters[1].number, 1);
assert.equal(fallbackChapters[1].index, 1);

const emptySearch = await fallbackRunner.getSearchResults(
  { query: "nonexistent" },
  99
);
assert.ok(emptySearch && Array.isArray(emptySearch.items));
assert.equal(emptySearch.items.length, 0);
assert.equal(emptySearch.isLastPage, true);
console.log(
  "PASS: On-page .list-chapter fallback and empty result safety ({ items: [] }) verified."
);

// 11c. v1.1 Verification: Ascending Chapter Ordering from Descending Source & Title Pollution Protection
class ReversedAndBrandedNetworkClient {
  async get(url) {
    if (url.includes("/ajax-chapter-option")) {
      return {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
        data: `
          <select class="chapter_jump form-control">
            <option value="/shadow-monarch/chapter-100-final-battle.html">Chapter 100: Final Battle</option>
            <option value="/shadow-monarch/chapter-50.5-side-story.html">Chapter 50.5: Side Story</option>
            <option value="/shadow-monarch/chapter-2-awakening.html">Chapter 2: Awakening</option>
            <option value="/shadow-monarch/chapter-1-the-beginning.html">Chapter 1: The Beginning</option>
          </select>
        `,
      };
    }
    if (url.endsWith("/shadow-monarch.html")) {
      return {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
        data: `
          <!DOCTYPE html>
          <html><body>
            <div class="col-info-desc">
              <div class="info-holder">
                <div class="books">
                  <div class="desc">
                    <h3 class="title">Shadow Monarch - Read Novel Online Free - NovelFull</h3>
                  </div>
                </div>
                <div class="info">
                  <div><h3>Author:</h3> <a href="/author/Chugong">Chugong</a></div>
                  <div><h3>Genre:</h3> <a href="/genre/Action">Action</a>, <a href="/genre/Fantasy">Fantasy</a></div>
                  <div><h3>Status:</h3> <span>Ongoing</span></div>
                </div>
              </div>
              <div class="desc">
                <div id="rating" data-novel-id="99887"></div>
                <div class="desc-text"><p>Shadow Monarch story summary.</p></div>
              </div>
            </div>
          </body></html>
        `,
      };
    }
    return {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
      data: "",
    };
  }
}

const v11Runner = new nfRunner.constructor(
  new (class extends nfRunner.scraper.constructor {
    constructor() {
      super(new ReversedAndBrandedNetworkClient());
    }
  })()
);

const v11Content = await v11Runner.getContent("shadow-monarch");
ContentSchema.parse(v11Content);
assert.equal(
  v11Content.title,
  "Shadow Monarch",
  "Title must be cleanly extracted without genre pollution or branding watermarks"
);
assert.notEqual(
  v11Content.title,
  "Genre:",
  "Title must not match <h3>Genre:</h3>"
);
assert.notEqual(
  v11Content.title,
  "Action",
  "Title must not be replaced by genre tag"
);

const v11Chapters = await v11Runner.getChapters("shadow-monarch");
assert.equal(v11Chapters.length, 4, "Must parse all 4 chapters");
assert.ok(v11Chapters.length > 0, "Chapters length must be > 0");
if (v11Chapters[0].number < v11Chapters[v11Chapters.length - 1].number) {
  throw new Error("Chapters array is sorted ascending instead of descending!");
}
assert.ok(
  v11Chapters[0].number >= v11Chapters[v11Chapters.length - 1].number,
  "Chapters array must be sorted descending"
);
assert.equal(v11Chapters[0].index, 0, "First chapter index must be 0");
for (let i = 0; i < v11Chapters.length; i++) {
  ChapterSchema.parse(v11Chapters[i]);
  assert.equal(
    v11Chapters[i].index,
    i,
    `Chapter at position ${i} must have sequential index ${i}`
  );
}

// Chapter 100 must be at index 0 (latest chapter)
assert.equal(v11Chapters[0].number, 100, "Chapter 100 must be at index 0");
assert.equal(v11Chapters[0].id, "chapter-100-final-battle");
assert.equal(v11Chapters[0].index, 0);

// Chapter 50.5 must be at index 1
assert.equal(v11Chapters[1].number, 50.5, "Chapter 50.5 must be at index 1");
assert.equal(v11Chapters[1].id, "chapter-50.5-side-story");
assert.equal(v11Chapters[1].index, 1);

// Chapter 2 must be at index 2
assert.equal(v11Chapters[2].number, 2, "Chapter 2 must be at index 2");
assert.equal(v11Chapters[2].id, "chapter-2-awakening");
assert.equal(v11Chapters[2].index, 2);

// Chapter 1 must be at index 3 (earliest chapter)
assert.equal(v11Chapters[3].number, 1, "Chapter 1 must be at index 3");
assert.equal(v11Chapters[3].id, "chapter-1-the-beginning");
assert.equal(v11Chapters[3].index, 3);

console.log(
  "PASS: Descending chapter order and clean title extraction verified."
);

// 11d. v1.6 Verification: Descending Chapter Order (Atsumaru Blueprint) & Comma-Safe Extraction
// 1. Consolidated Title Scraping & Deduplication (Requirement 3.1)
assert.equal(
  typeof nfRunner.cleanTitle,
  "function",
  "cleanTitle must be exposed"
);
assert.equal(
  nfRunner.cleanTitle("Super GeneSuper Gene"),
  "Super Gene",
  "Must deduplicate exact string repetition 'Super GeneSuper Gene' to 'Super Gene'"
);
assert.equal(
  nfRunner.cleanTitle("Martial World Martial World"),
  "Martial World",
  "Must deduplicate word repetition 'Martial World Martial World' to 'Martial World'"
);
assert.equal(
  nfRunner.cleanTitle("TitleTitle"),
  "Title",
  "Must deduplicate 'TitleTitle' to 'Title'"
);
assert.equal(
  nfRunner.cleanTitle("Title Title"),
  "Title",
  "Must deduplicate 'Title Title' to 'Title'"
);
assert.equal(
  nfRunner.cleanTitle("Read Super Gene - NovelFull"),
  "Super Gene",
  "Must strip branding prefixes and suffixes"
);
assert.equal(
  nfRunner.cleanTitle("Shadow Slave online free on web"),
  "Shadow Slave",
  "Must strip online free suffixes"
);

// 2. Bulletproof Chapter Number Parsing (Requirement 1.2)
assert.equal(
  typeof nfRunner.parseChapterNumber,
  "function",
  "parseChapterNumber must be exposed"
);
// Match "Chapter 123", "Ch. 123", "C123", "C.123"
assert.equal(
  nfRunner.parseChapterNumber("C1 - Chapter 1 - The Beginning", "", 99),
  1
);
assert.equal(
  nfRunner.parseChapterNumber("C1541 - 911: Return", "", 99),
  1541
);
assert.equal(
  nfRunner.parseChapterNumber("Chapter 403 : Awakening", "", 99),
  403
);
assert.equal(
  nfRunner.parseChapterNumber("Ch. 2: Evolution", "", 99),
  2
);
// Match leading digits: "123: Title" or "123 - Title"
assert.equal(
  nfRunner.parseChapterNumber("1541 - 911: Return", "", 99),
  1541
);
assert.equal(
  nfRunner.parseChapterNumber("1: The Arrival", "", 99),
  1
);
// Match URL patterns: /chapter-123-title.html
assert.equal(
  nfRunner.parseChapterNumber("Prologue", "/super-gene/chapter-1-slug.html", 99),
  1
);
assert.equal(
  nfRunner.parseChapterNumber("Side Story", "chapter-50-5-bonus", 99),
  50.5
);
// Standalone number
assert.equal(
  nfRunner.parseChapterNumber("Extra Episode 7", "", 99),
  7
);
// Comma-safe chapter number parsing (v1.6)
assert.equal(
  nfRunner.parseChapterNumber("Chapter 1,000: Battle", "/super-gene/chapter-1000.html"),
  1000,
  "parseChapterNumber must correctly parse 1000 from 'Chapter 1,000: Battle' with URL"
);
assert.equal(
  nfRunner.parseChapterNumber("Chapter 1: Start", "/super-gene/chapter-1.html"),
  1,
  "parseChapterNumber must correctly parse 1 from 'Chapter 1: Start' with URL"
);
assert.equal(
  nfRunner.parseChapterNumber("Chapter 1,000: Battle", ""),
  1000,
  "parseChapterNumber must correctly parse 1000 from title without URL"
);
assert.equal(
  nfRunner.parseChapterNumber("Chapter 2,450.5 - Extra", ""),
  2450.5,
  "parseChapterNumber must correctly parse decimal chapters with commas"
);
// Fallback: Never returns NaN
const fallbackVal = nfRunner.parseChapterNumber("Random Title Without Any Digits", "", 42);
assert.equal(fallbackVal, 42);
assert.ok(!Number.isNaN(fallbackVal), "parseChapterNumber must never return NaN");

// Realistic chapter simulation asserting chapters[0].number > 1000, chapters[last].number === 1
const realisticRawEntries = [
  { id: "ch-1541", title: "C1541 - 911: Return", chapterId: "chapter-1541.html" },
  { id: "ch-1000", title: "Chapter 1,000: Battle", chapterId: "chapter-1000.html" },
  { id: "ch-403", title: "Chapter 403: Awakening", chapterId: "chapter-403.html" },
  { id: "ch-2", title: "Ch. 2: Evolution", chapterId: "chapter-2.html" },
  { id: "ch-1", title: "C1 - Chapter 1: Start", chapterId: "chapter-1.html" },
];
const simChapters = nfRunner.mapChapterEntriesToChapters(realisticRawEntries, "super-gene");
if (simChapters.length > 1 && simChapters[0].number < simChapters[simChapters.length - 1].number) {
  throw new Error("FAIL: Chapters are ascending! Reader navigation will be inverted in Suwatte.");
}
assert.equal(simChapters[0].number, 1541, "Simulated chapters[0].number must equal 1541 (latest chapter)");
assert.equal(simChapters[0].index, 0, "Simulated chapters[0].index must equal 0");
assert.equal(simChapters[simChapters.length - 1].number, 1, "Simulated chapters[last].number must equal 1 (earliest chapter)");
assert.equal(simChapters[simChapters.length - 1].index, 4, "Simulated chapters[last].index must equal 4");
assert.ok(
  simChapters[0].number > simChapters[simChapters.length - 1].number,
  "Simulated chapters[0].number must be > last chapter number"
);

// 3. Mocked getContent() & getChapters() with Duplicate Title & Descending Chapters
class MockDuplicateTitleAndDescendingNetworkClient {
  async get(url) {
    if (url.includes("/ajax-chapter-option")) {
      // Descending chapter list with diverse format patterns including comma chapter
      return {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
        data: `
          <select class="chapter_jump form-control">
            <option value="/super-gene/chapter-1541-return.html">C1541 - 911: Return</option>
            <option value="/super-gene/chapter-1000-battle.html">Chapter 1,000: Battle</option>
            <option value="/super-gene/chapter-403-awakening.html">Chapter 403 : Awakening</option>
            <option value="/super-gene/chapter-2-evolution.html">Ch. 2: Evolution</option>
            <option value="/super-gene/chapter-1-slug.html">C1 - Chapter 1 - The Beginning</option>
          </select>
        `,
      };
    }

    if (url.endsWith("/super-gene.html")) {
      return {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
        data: `
          <!DOCTYPE html>
          <html>
          <head>
            <meta property="og:title" content="Super GeneSuper Gene - Read Novel Online Free - NovelFull" />
          </head>
          <body>
            <div class="col-info-desc">
              <div class="info-holder">
                <div class="books">
                  <div class="desc">
                    <h3 class="title"><a href="/super-gene.html">Super Gene</a>Super Gene</h3>
                  </div>
                </div>
                <div class="info">
                  <div><h3>Author:</h3> <a href="/author/Twelve-Winged-Dark-Seraphim">Twelve-Winged Dark Seraphim</a></div>
                  <div><h3>Genre:</h3> <a href="/genre/Action">Action</a>, <a href="/genre/Sci-Fi">Sci-Fi</a></div>
                  <div><h3>Status:</h3> <span>Completed</span></div>
                </div>
              </div>
              <div class="desc">
                <div id="rating" data-novel-id="55443"></div>
                <div class="desc-text"><p>In the magnificent galaxy...</p></div>
              </div>
            </div>
          </body>
          </html>
        `,
      };
    }

    return {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
      data: "",
    };
  }
}

const v16Runner = new nfRunner.constructor(
  new (class extends nfRunner.scraper.constructor {
    constructor() {
      super(new MockDuplicateTitleAndDescendingNetworkClient());
    }
  })()
);

// Verify Title Scraping & Deduplication in getContent()
const v16Content = await v16Runner.getContent("super-gene");
ContentSchema.parse(v16Content);
assert.equal(
  v16Content.title,
  "Super Gene",
  "getContent() must return a clean single title without 'Super GeneSuper Gene' duplication"
);
assert.notEqual(
  v16Content.title,
  "Super GeneSuper Gene",
  "Title must not be duplicated"
);

// Verify Chapter Order Validation (Atsumaru Blueprint: Descending)
const v16Chapters = await v16Runner.getChapters("super-gene");
assert.ok(v16Chapters.length > 0, "Chapters length must be > 0");

// Console Output Verification Requirement:
console.log(
  `FIRST: ${v16Chapters[0].title} (num: ${v16Chapters[0].number}, idx: ${v16Chapters[0].index})`
);
console.log(
  `LAST: ${v16Chapters[v16Chapters.length - 1].title} (num: ${v16Chapters[v16Chapters.length - 1].number}, idx: ${v16Chapters[v16Chapters.length - 1].index})`
);

// Confirm chapters[0].number === 1541 (Latest)
assert.equal(v16Chapters[0].number, 1541, "chapters[0].number must equal 1541 (latest chapter)");
// Confirm chapters[0].index === 0
assert.equal(v16Chapters[0].index, 0, "chapters[0].index must equal 0");

// Confirm chapters[last].number === 1 (First Chapter for 'Start Reading')
assert.equal(v16Chapters[v16Chapters.length - 1].number, 1, "chapters[last].number must equal 1");
assert.equal(v16Chapters[v16Chapters.length - 1].index, v16Chapters.length - 1, "chapters[last].index must be N - 1");

// Assert chapters[0].number > chapters[chapters.length - 1].number (throw if ascending)
if (v16Chapters[0].number <= v16Chapters[v16Chapters.length - 1].number) {
  throw new Error("FAIL: Chapters are ascending! Reader navigation will be inverted in Suwatte.");
}
assert.ok(
  v16Chapters[0].number > v16Chapters[v16Chapters.length - 1].number,
  "chapters[0].number must be strictly greater than chapters[last].number"
);

assert.equal(v16Chapters[0].number, 1541, "First chapter must be Chapter 1541");
assert.equal(v16Chapters[0].index, 0, "First chapter index must be 0");
assert.equal(v16Chapters[1].number, 1000, "Second chapter must be Chapter 1000");
assert.equal(v16Chapters[1].index, 1, "Second chapter index must be 1");
assert.equal(v16Chapters[2].number, 403, "Third chapter must be Chapter 403");
assert.equal(v16Chapters[2].index, 2, "Third chapter index must be 2");
assert.equal(v16Chapters[3].number, 2, "Fourth chapter must be Chapter 2");
assert.equal(v16Chapters[3].index, 3, "Fourth chapter index must be 3");
assert.equal(v16Chapters[4].number, 1, "Fifth chapter must be Chapter 1");
assert.equal(v16Chapters[4].index, 4, "Fifth chapter index must be 4");

for (let i = 0; i < v16Chapters.length; i++) {
  ChapterSchema.parse(v16Chapters[i]);
  assert.equal(
    v16Chapters[i].index,
    i,
    `Chapter at position ${i} must have sequential index ${i}`
  );
}

console.log(
  "PASS: v1.6 Descending chapter order (Atsumaru blueprint), comma-safe parsing, and clean title scraping verified."
);

// 12. Native Novel Text Reader & Sanitization Engine (getChapterText)
const nfChapterText = await nfRunner.getChapterText(
  "martial-peak",
  "chapter-1-prologue"
);
SourceChapterTextSchema.parse(nfChapterText);
assert.equal(nfChapterText.format, "html");
assert.ok(
  !nfChapterText.body.includes("<script") &&
    !nfChapterText.body.includes("<style") &&
    !nfChapterText.body.includes("<iframe") &&
    !nfChapterText.body.includes("<noscript") &&
    !nfChapterText.body.includes("<ins"),
  "Must strip script, style, iframe, noscript, and ins tags"
);
assert.ok(
  !nfChapterText.body.includes("Advertisement Banner") &&
    !nfChapterText.body.includes("AdSense Block") &&
    !nfChapterText.body.includes("Ad Box") &&
    !nfChapterText.body.includes("GPT Ad") &&
    !nfChapterText.body.includes("Ad Container"),
  "Must strip surgical ad DOM selectors (.ads, .ads-holder, .ads-box, .adsbygoogle, div-gpt-ad, ad-container)"
);
assert.ok(
  nfChapterText.body.includes("System Alert"),
  "Must preserve centered dialogue (<div align='center'>System Alert</div>)"
);
assert.ok(
  nfChapterText.body.includes("&lt;Come forward.&gt;"),
  "Must preserve <Come forward.> encoded as &lt;Come forward.&gt; in HTML output"
);
assert.ok(
  nfChapterText.body.includes("<span>Bare span dialogue</span>") &&
    nfChapterText.body.includes("Bare text after br"),
  "Must preserve bare text nodes and inline spans separated by <br>"
);
assert.ok(
  !nfChapterText.body.toLowerCase().includes("read novel online free on novelfull") &&
    !nfChapterText.body.toLowerCase().includes("visit novelfull.com for the best") &&
    !nfChapterText.body.toLowerCase().includes("if you discover any errors") &&
    !nfChapterText.body.includes("Previous Chapter") &&
    !nfChapterText.body.includes("Next Chapter") &&
    !nfChapterText.body.includes("Table of Contents"),
  "Must strip aggregator watermarks and standalone navigation leak lines"
);
assert.ok(
  nfChapterText.body.includes(
    "> 💡 **Translator Note:** Black Stone Pillow is an Emperor Artifact"
  ),
  "Must transform [TL Note: ...] into callout blockquote"
);
assert.ok(
  nfChapterText.body.includes(
    "“The journey to the martial peak is lonely,” Yang Kai whispered—clenching his fists."
  ),
  "Must normalize typography entities and apply smart curly quotes (&ldquo;, &rdquo;, &mdash;, &nbsp;)"
);
assert.ok(
  nfChapterText.body.includes("…</p>"),
  "Must normalize &hellip; to … when smart_typography is enabled"
);
assert.ok(
  nfChapterText.body.includes("\n\n"),
  "Must normalize paragraph spacing with balanced \\n\\n"
);
console.log(
  "PASS: getChapterText() surgical ad removal, watermark stripping, < > preservation, TLN formatting, and entity normalization verified."
);

// 12b. In-Memory Parsing Performance Benchmark (150 KB+ Full-Page HTML, Requirement: < 15ms)
const headBoilerplate = `<head><title>Chapter 2239</title>${"<meta name='x' content='y'/>".repeat(250)}<script>${"var x = 1;".repeat(4000)}</script></head>`;
const navbarAndSidebarBoilerplate = `<header><nav>${"<a href='/genre/Action'>Action</a>".repeat(1200)}</nav></header><aside class="sidebar">${"<div class='widget'>Sidebar Widget Entry</div>".repeat(900)}</aside>`;
const footerBoilerplate = `<div id="chapter-nav"><a href="/prev">Prev</a><a href="/next">Next</a></div><footer>${"<p>Footer copyright link</p>".repeat(1200)}<script>${"console.log(1);".repeat(2000)}</script></footer>`;
const twentyFiveParagraphs = Array.from(
  { length: 25 },
  (_, idx) =>
    `<p>"This is paragraph ${idx + 1} of the battle," Arthur declared--raising his sword before the gate... [System Alert ${idx + 1}]</p>`
).join("\n");
const large150KbChapterHtml = `<!DOCTYPE html><html>${headBoilerplate}<body>${navbarAndSidebarBoilerplate}<div id="chapter-content" class="chapter-c">${twentyFiveParagraphs}</div>${footerBoilerplate}</body></html>`;
const largeHtmlBytes = Buffer.byteLength(large150KbChapterHtml, "utf8");
assert.ok(
  largeHtmlBytes >= 150 * 1024,
  `Benchmark HTML payload must be >= 150 KB, got ${largeHtmlBytes} bytes`
);

// Warm up JIT once, then measure realistic 150 KB full-page parse latency
nfRunner.sanitizeChapterHtml(large150KbChapterHtml);
const benchRuns = 50;
const benchStart = performance.now();
for (let i = 0; i < benchRuns; i++) {
  nfRunner.sanitizeChapterHtml(large150KbChapterHtml);
}
const benchTotal = performance.now() - benchStart;
const avgMs = benchTotal / benchRuns;
console.log(
  `BENCHMARK: ${benchRuns} full-page (${(largeHtmlBytes / 1024).toFixed(1)} KB) getChapterText parses in ${benchTotal.toFixed(2)}ms (${avgMs.toFixed(4)}ms/parse)`
);
assert.ok(
  avgMs < 15,
  `getChapterText 150KB+ in-memory parsing must be under 15ms, got ${avgMs.toFixed(4)}ms`
);
console.log(
  `PASS: getChapterText() near-instant pre-Cheerio slicing verified (${avgMs.toFixed(4)}ms < 15ms target).`
);

// 12c. v1.7 Verification: Angle-Bracket Dialogue, Inline Watermarks, Centered Dialogue & Deterministic Resume
class V17ChapterTestClient {
  async get(url) {
    if (url.includes("/ajax-chapter-option")) {
      return {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
        data: `
          <select class="chapter_jump form-control">
            <option value="/test-novel/chapter-1-prologue.html">Prologue</option>
            <option value="/test-novel/chapter-2-awakening.html">Chapter 2: Awakening</option>
            <option value="/test-novel/chapter-10-2-years-later.html">Chapter 10: 2 Years Later</option>
          </select>
        `,
      };
    }
    if (url.endsWith("/test-novel.html")) {
      return {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
        data: `
          <html><body>
            <div class="col-info-desc">
              <div class="books"><div class="desc"><h3 class="title">Test Novel</h3></div></div>
              <div id="rating" data-novel-id="77777"></div>
            </div>
          </body></html>
        `,
      };
    }
    if (url.endsWith("/test-novel/chapter-raw-brackets.html")) {
      return {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
        data: `
          <div id="chapter-content" class="chapter-c">
            <p><Come forward.></p>
            <p><I am a god.></p>
            <p><<Nested Alert>></p>
            <div align="center">System Alert</div>
            <center>Level Up</center>
            <p>"Hello!" Read novel online free on novelfull.com "Goodbye!"</p>
            <span>First span line</span><br><div>Second div line</div>Bare text line
          </div>
        `,
      };
    }
    if (url.endsWith("/test-novel/chapter-escaped-brackets.html")) {
      return {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
        data: `
          <div id="chapter-content" class="chapter-c">
            <p>&lt;Come forward.&gt;</p>
            <p>&lt;I am a god.&gt;</p>
          </div>
        `,
      };
    }
    return {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
      data: "",
    };
  }
}

const v17Runner = new nfRunner.constructor(
  new (class extends nfRunner.scraper.constructor {
    constructor() {
      super(new V17ChapterTestClient());
    }
  })()
);

for (const sanitizeFlag of [true, false]) {
  await v17Runner.onFormSubmitted("novelfull_prefs", {
    sanitize_ads: sanitizeFlag,
    format_tln: true,
    normalize_spacing: true,
  });

  const rawRes = await v17Runner.getChapterText("test-novel", "chapter-raw-brackets");
  SourceChapterTextSchema.parse(rawRes);
  assert.ok(
    rawRes.body.includes("&lt;Come forward.&gt;"),
    `Raw <Come forward.> must stay encoded as &lt;Come forward.&gt; (sanitize_ads=${sanitizeFlag})`
  );
  assert.ok(
    rawRes.body.includes("&lt;I am a god.&gt;"),
    `Raw <I am a god.> must not be misparsed as <i> (sanitize_ads=${sanitizeFlag})`
  );
  assert.ok(
    rawRes.body.includes("&lt;&lt;Nested Alert&gt;&gt;"),
    `Nested <<Nested Alert>> must be preserved (sanitize_ads=${sanitizeFlag})`
  );
  const $rawRendered = cheerio.load(rawRes.body);
  assert.ok(
    $rawRendered.text().includes("<Come forward.>"),
    `Rendered HTML text must visibly contain '<Come forward.>' (sanitize_ads=${sanitizeFlag})`
  );
  assert.ok(
    rawRes.body.includes("<p>System Alert</p>") &&
      rawRes.body.includes("<p>Level Up</p>"),
    `Centered dialogue must be preserved (sanitize_ads=${sanitizeFlag})`
  );
  assert.ok(
    rawRes.body.includes("<p><span>First span line</span></p>") &&
      rawRes.body.includes("<p>Second div line</p>") &&
      rawRes.body.includes("<p>Bare text line</p>"),
    `Bare text nodes across <span>, <br>, and <div> must be preserved (sanitize_ads=${sanitizeFlag})`
  );

  if (sanitizeFlag) {
    assert.ok(
      rawRes.body.includes("<p>“Hello!”</p>\n\n<p>“Goodbye!”</p>"),
      "Inline watermark must be stripped and back-to-back quotes split with smart quotes by default"
    );
  }

  const escapedRes = await v17Runner.getChapterText("test-novel", "chapter-escaped-brackets");
  SourceChapterTextSchema.parse(escapedRes);
  assert.ok(
    escapedRes.body.includes("&lt;Come forward.&gt;"),
    `Escaped &lt;Come forward.&gt; must stay encoded as &lt;Come forward.&gt; (sanitize_ads=${sanitizeFlag})`
  );
  const $escapedRendered = cheerio.load(escapedRes.body);
  assert.ok(
    $escapedRendered.text().includes("<Come forward.>"),
    `Escaped input must visibly render '<Come forward.>' (sanitize_ads=${sanitizeFlag})`
  );
}

// Deterministic paragraph output across reloads (for Suwatte chapter resume offset)
const loadA = await v17Runner.getChapterText("test-novel", "chapter-raw-brackets");
const loadB = await v17Runner.getChapterText("test-novel", "chapter-raw-brackets");
assert.equal(
  loadA.body,
  loadB.body,
  "getChapterText() must produce byte-identical deterministic output across reloads"
);

// parseChapterNumber title-vs-URL consistency and getChapters deterministic indices
assert.equal(
  v17Runner.parseChapterNumber("Chapter 10: 2 Years Later", "/test-novel/chapter-10-2-years-later.html"),
  10,
  "Must parse Chapter 10 instead of misreading '-10-2-' in URL as 10.2"
);
const chReload1 = await v17Runner.getChapters("test-novel");
const chReload2 = await v17Runner.getChapters("test-novel");
assert.equal(chReload1.length, 3);
assert.deepEqual(
  chReload1.map((c) => ({ id: c.id, index: c.index, number: c.number })),
  chReload2.map((c) => ({ id: c.id, index: c.index, number: c.number })),
  "getChapters() must produce identical ordering, chapterId, and indices across reloads"
);
const seenIndices = new Set();
for (let i = 0; i < chReload1.length; i++) {
  const ch = chReload1[i];
  ChapterSchema.parse(ch);
  assert.ok(!Number.isNaN(ch.index) && ch.index === i, "index must be sequential with zero NaN");
  assert.ok(!Number.isNaN(ch.number), "number must never be NaN");
  assert.ok(!seenIndices.has(ch.index), "index must be unique");
  seenIndices.add(ch.index);
}
assert.equal(chReload1[0].number, 10);
assert.equal(chReload1[1].number, 2);
assert.equal(chReload1[2].number, 1);

console.log(
  "PASS: v1.7 < > dialogue preservation, surgical ad blocking, centered dialogue, and deterministic resume verified."
);

// 12d. v1.8 Reader Layout & Typography Engine Assertions
const v18SampleHtml = `
<!DOCTYPE html>
<html>
<body>
  <div id="chapter-content" class="chapter-c">
    <p>Chapter 1: Title</p>
    <p>"Hello there!" "General Kenobi?" <span class="speaker" data-id="npc-1">"We meet again."</span></p>
    <p>"I won't forgive you for this betrayal!" Arthur slammed his heavy gauntlet onto the oak table, shattering the porcelain teacup into razor-sharp splinters. "You crossed the line this time," Elena replied coldly, drawing her silver blade as frost crept across the stone floor.</p>
    <p>He shouted "Fire!" and charged.</p>
    <p>&lt;Who goes there?&gt; &lt;Step into the light.&gt;</p>
    <p>[System Notification: Level Up!]</p>
    <p><Come forward.></p>
    <p>Name: Sung Jin-Woo</p>
    <p>| STR: 145 | AGI: 138 | INT: 99 |</p>
    <p>***</p>
    <p>He muttered, 'I don't know--maybe it's over...'</p>
    <p>Chapter 3 of the manual was missing.</p>
  </div>
</body>
</html>
`;

const v18Formatted = nfRunner.sanitizeChapterHtml(v18SampleHtml, {
  sanitizeAds: true,
  formatTln: true,
  normalizeSpacing: true,
  splitDialogue: true,
  formatCallouts: true,
  smartTypography: true,
});

// Duplicate header stripped, while prose starting with "Chapter 3..." is kept
assert.ok(
  !v18Formatted.includes("Chapter 1: Title"),
  "Duplicate chapter header at start of chapter body must be stripped"
);
assert.ok(
  v18Formatted.includes("<p>Chapter 3 of the manual was missing.</p>"),
  "Prose mentioning Chapter 3 mid-sentence must NOT be falsely stripped"
);

// Back-to-back quotes split & dense multi-speaker >220 char beat split
assert.ok(
  v18Formatted.includes("<p>“Hello there!”</p>\n\n<p>“General Kenobi?”</p>"),
  "Back-to-back dialogue quotes must split into separate paragraphs"
);
assert.ok(
  v18Formatted.includes(
    "<p>“I won’t forgive you for this betrayal!” Arthur slammed his heavy gauntlet onto the oak table, shattering the porcelain teacup into razor-sharp splinters.</p>\n\n<p>“You crossed the line this time,” Elena replied coldly, drawing her silver blade as frost crept across the stone floor.</p>"
  ),
  "Dense >220 char multi-speaker paragraph with narrative beat must split before new speaker quote"
);

// Safety: Mid-sentence quote must NOT be split
assert.ok(
  v18Formatted.includes("<p>He shouted “Fire!” and charged.</p>"),
  "Mid-sentence quote must NOT be split"
);

// Telepathy split + callout wrapping + < > preservation
assert.ok(
  v18Formatted.includes(
    "<blockquote>&lt;Who goes there?&gt;</blockquote>\n\n<blockquote>&lt;Step into the light.&gt;</blockquote>"
  ),
  "Back-to-back telepathy pairs must split and format into distinct callout blockquotes"
);
assert.ok(
  v18Formatted.includes("<blockquote>[System Notification: Level Up!]</blockquote>"),
  "[System Notification: Level Up!] must format into <blockquote>"
);
assert.ok(
  v18Formatted.includes("<blockquote>&lt;Come forward.&gt;</blockquote>"),
  "<Come forward.> must format into <blockquote> while staying encoded as &lt;Come forward.&gt;"
);
const $v18Rendered = cheerio.load(v18Formatted);
assert.ok(
  $v18Rendered.text().includes("<Come forward.>"),
  "Rendered HTML must visibly preserve '<Come forward.>' inside callout"
);
assert.ok(
  v18Formatted.includes("<blockquote>Name: Sung Jin-Woo</blockquote>") &&
    v18Formatted.includes("<blockquote>| STR: 145 | AGI: 138 | INT: 99 |</blockquote>"),
  "Stat headers and pipe-delimited stat lines must format into <blockquote>"
);

// Scene divider conversion & HTML attribute preservation
assert.ok(
  v18Formatted.includes("\n\n<hr />\n\n"),
  "ASCII *** scene divider must become <hr />"
);
assert.ok(
  v18Formatted.includes('<span class="speaker" data-id="npc-1">“We meet again.”</span>'),
  "Smart quotes must convert prose quotes without mutating HTML tag attributes"
);
assert.ok(
  v18Formatted.includes("He muttered, ‘I don’t know—maybe it’s over…’"),
  "Smart single quotes, apostrophes, em-dashes (-- -> —), and ellipses (... -> …) must apply cleanly"
);

// Verify toggles can cleanly disable each feature
const v18RawToggles = nfRunner.sanitizeChapterHtml(v18SampleHtml, {
  sanitizeAds: true,
  formatTln: true,
  normalizeSpacing: true,
  splitDialogue: false,
  formatCallouts: false,
  smartTypography: false,
});
assert.ok(
  v18RawToggles.includes('<p>"Hello there!" "General Kenobi?"'),
  "split_dialogue=false must keep adjacent dialogue unsplit"
);
assert.ok(
  v18RawToggles.includes("<p>[System Notification: Level Up!]</p>") &&
    v18RawToggles.includes("<p>&lt;Come forward.&gt;</p>"),
  "format_callouts=false must keep callouts as normal <p> paragraphs"
);
assert.ok(
  v18RawToggles.includes("<p>***</p>") &&
    v18RawToggles.includes("He muttered, 'I don't know--maybe it's over...'"),
  "smart_typography=false must preserve ASCII scene dividers, straight quotes, --, and ..."
);

console.log(
  "PASS: v1.8 Reader Layout & Typography Engine (dialogue split, callouts, smart quotes, scene breaks, duplicate header removal) verified."
);

// 13. Verify Multi-Source Catalog Manifest (dist/sources.json & root sources.json)
const sourcesJsonRaw = fs.readFileSync(
  path.resolve("./dist/sources.json"),
  "utf8"
);
const sourcesCatalog = JSON.parse(sourcesJsonRaw);
assert.equal(
  sourcesCatalog.sources.length,
  3,
  "dist/sources.json must contain all 3 sources: moe.atsu, org.imhentai, and org.novelfull"
);

const atsuEntry = sourcesCatalog.sources.find((s) => s.id === "moe.atsu");
const imEntry = sourcesCatalog.sources.find((s) => s.id === "org.imhentai");
const nfEntry = sourcesCatalog.sources.find((s) => s.id === "org.novelfull");

assert.ok(atsuEntry, "moe.atsu must exist in dist/sources.json");
assert.ok(imEntry, "org.imhentai must exist in dist/sources.json");
assert.ok(nfEntry, "org.novelfull must exist in dist/sources.json");

assert.equal(nfEntry.id, "org.novelfull");
assert.equal(nfEntry.name, "NovelFull");
assert.equal(nfEntry.version, 1.8);
assert.equal(nfEntry.path, "org.novelfull");
assert.equal(nfEntry.variantId, "org.novelfull");
assert.equal(nfEntry.thumbnail, "novelfull.png");
assert.equal(nfEntry.environment, "jsc");
assert.equal(nfEntry.minSupportedAppVersion, undefined);

const rootSourcesJsonRaw = fs.readFileSync(
  path.resolve("./sources.json"),
  "utf8"
);
const rootSourcesCatalog = JSON.parse(rootSourcesJsonRaw);
assert.equal(
  rootSourcesCatalog.sources.length,
  3,
  "root sources.json must contain all 3 sources: moe.atsu, org.imhentai, and org.novelfull"
);
const rootNfEntry = rootSourcesCatalog.sources.find((s) => s.id === "org.novelfull");
assert.ok(rootNfEntry, "org.novelfull must exist in root sources.json");
assert.equal(rootNfEntry.version, 1.8);
assert.equal(rootNfEntry.variantId, "org.novelfull");
assert.equal(rootNfEntry.thumbnail, "novelfull.png");

const rootSttPath = path.resolve("./sources/org.novelfull.stt");
assert.ok(fs.existsSync(rootSttPath), "Root sources/org.novelfull.stt must exist");
assert.equal(
  Buffer.compare(fs.readFileSync(sttPath), fs.readFileSync(rootSttPath)),
  0,
  "Root sources/org.novelfull.stt must match dist/sources/org.novelfull.stt"
);
console.log(
  "PASS: Multi-source catalog manifest (dist/sources.json & root sources.json) and root sources/org.novelfull.stt sync verified."
);

// 14. Icon Validation (Requirement 4.2)
const assetIconPath = path.resolve("./assets/novelfull.png");
assert.ok(fs.existsSync(assetIconPath), "assets/novelfull.png must exist");
const assetIconStat = fs.statSync(assetIconPath);
assert.ok(
  assetIconStat.size > 500,
  `assets/novelfull.png file size must be > 500 bytes, got ${assetIconStat.size}`
);
assert.equal(
  nfEntry.thumbnail,
  "novelfull.png",
  "dist/sources.json must specify thumbnail 'novelfull.png'"
);
console.log(
  `PASS: Icon validation verified (assets/novelfull.png: ${assetIconStat.size} bytes > 500 bytes, thumbnail='novelfull.png').`
);

console.log("=== ALL NOVELFULL QA AUTOMATED VALIDATION CHECKS PASSED ===");
