const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");
const cheerio = require("cheerio");

const BASE_URL = "https://megakino4.to";
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept-Language": "de-DE,de;q=0.9,en;q=0.8",
  Referer: BASE_URL,
};

let sessionCookies = "";

async function getToken() {
  try {
    const resp = await axios.get(`${BASE_URL}/index.php?yg=token`, { headers: HEADERS });
    const cookies = resp.headers["set-cookie"];
    if (cookies) sessionCookies = cookies.map(c => c.split(";")[0]).join("; ");
  } catch (e) {
    console.log("Token error:", e.message);
  }
}

async function fetchPage(url) {
  if (!sessionCookies) await getToken();
  const resp = await axios.get(url, { headers: { ...HEADERS, Cookie: sessionCookies }, timeout: 10000 });
  if (resp.data.includes("yg=token")) {
    await getToken();
    const resp2 = await axios.get(url, { headers: { ...HEADERS, Cookie: sessionCookies }, timeout: 10000 });
    return cheerio.load(resp2.data);
  }
  return cheerio.load(resp.data);
}

const manifest = {
  id: "community.megakino4to",
  version: "1.0.0",
  name: "MegaKino",
  description: "Filme und Serien auf Deutsch von megakino4.to",
  logo: "https://megakino4.to/favicon.ico",
  resources: ["catalog", "meta", "stream"],
  types: ["movie", "series"],
  idPrefixes: ["megakino:"],
  catalogs: [
    { type: "movie", id: "megakino-movies", name: "MegaKino Filme", extra: [{ name: "search", isRequired: false }, { name: "skip" }] },
    { type: "series", id: "megakino-series", name: "MegaKino Serien", extra: [{ name: "search", isRequired: false }, { name: "skip" }] },
  ],
};

const builder = new addonBuilder(manifest);

builder.defineCatalogHandler(async ({ type, id, extra }) => {
  try {
    const search = extra && extra.search;
    const skip = (extra && parseInt(extra.skip)) || 0;
    const page = Math.floor(skip / 35) + 1;

    let url;
    if (search) {
      url = `${BASE_URL}/index.php?do=search&subaction=search&story=${encodeURIComponent(search)}`;
    } else if (type === "movie") {
      url = page > 1 ? `${BASE_URL}/films/page/${page}/` : `${BASE_URL}/films/`;
    } else {
      url = page > 1 ? `${BASE_URL}/serials/page/${page}/` : `${BASE_URL}/serials/`;
    }

    const $ = await fetchPage(url);
    const metas = [];

    $("a.poster.grid-item, a.top.d-flex.fd-column.has-overlay").each((_, el) => {
      const href = $(el).attr("href") || "";
      const title = $(el).find(".poster__title, .top__title").text().trim();
      const poster = $(el).find("img").attr("data-src") || $(el).find("img").attr("src") || "";
      if (!href || !title) return;
      const metaId = "megakino:" + href.replace(/^\//, "");
      const metaType = href.includes("/serials/") ? "series" : "movie";
      if ((type === "movie" && metaType === "movie") || (type === "series" && metaType === "series") || search) {
        metas.push({
          id: metaId,
          type,
          name: title,
          poster: poster.startsWith("http") ? poster : poster ? BASE_URL + "/" + poster.replace(/^\//, "") : undefined,
        });
      }
    });

    console.log(`Found ${metas.length} items for ${type} page ${page}`);
    return { metas };
  } catch (err) {
    console.error("Catalog error:", err.message);
    return { metas: [] };
  }
});

builder.defineMetaHandler(async ({ type, id }) => {
  try {
    const path = id.replace("megakino:", "");
    const url = BASE_URL + "/" + path.replace(/^\//, "");
    const $ = await fetchPage(url);
    const title = $("h1").first().text().trim();
    const poster = $(".full-poster img, .poster img").first().attr("src") || "";
    const description = $(".full-text, [itemprop='description']").first().text().trim();
    return { meta: { id, type, name: title, poster: poster.startsWith("http") ? poster : poster ? BASE_URL + poster : undefined, description } };
  } catch (err) {
    console.error("Meta error:", err.message);
    return { meta: {} };
  }
});

builder.defineStreamHandler(async ({ type, id }) => {
  try {
    const path = id.replace("megakino:", "");
    const url = BASE_URL + "/" + path.replace(/^\//, "");
    const $ = await fetchPage(url);
    const streams = [];
    $("iframe").each((_, el) => {
      const src = $(el).attr("src") || $(el).attr("data-src");
      if (src) streams.push({ title: "MegaKino Stream", externalUrl: src.startsWith("http") ? src : "https:" + src });
    });
    $("script").each((_, el) => {
      const text = $(el).html() || "";
      const m3u8Match = text.match(/['"]([^'"]+\.m3u8[^'"]*)['"]/);
      const mp4Match = text.match(/['"]([^'"]+\.mp4[^'"]*)['"]/);
      if (m3u8Match) streams.push({ title: "MegaKino HLS", url: m3u8Match[1] });
      else if (mp4Match) streams.push({ title: "MegaKino MP4", url: mp4Match[1] });
    });
    if (streams.length === 0) streams.push({ title: "Im Browser öffnen", externalUrl: url });
    return { streams };
  } catch (err) {
    console.error("Stream error:", err.message);
    return { streams: [] };
  }
});

const PORT = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port: PORT });
console.log(`\n✅  MegaKino Addon läuft auf: http://localhost:${PORT}`);
console.log(`📦  Manifest: http://localhost:${PORT}/manifest.json\n`);
getToken().then(() => console.log("✅  Token geholt!\n"));