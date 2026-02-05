const http = require("http");
const { URL } = require("url");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const DATASET = process.env.HF_DATASET || "TempoFunk/webvid-10M";
const HF_BASE = "https://datasets-server.huggingface.co";
const CONFIG_ENV = process.env.HF_CONFIG;
const SPLIT_ENV = process.env.HF_SPLIT;
const URL_FIELD_ENV = process.env.VIDEO_URL_FIELD;

let cachedConfig = null;
let cachedSplit = null;
let cachedSize = null;

async function fetchJson(url) {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HF error ${response.status}: ${text}`);
  }
  return response.json();
}

async function resolveSplitInfo() {
  if (cachedConfig && cachedSplit && cachedSize !== null) {
    return { config: cachedConfig, split: cachedSplit, size: cachedSize };
  }

  const url = new URL(`${HF_BASE}/splits`);
  url.searchParams.set("dataset", DATASET);
  const data = await fetchJson(url.toString());

  const config = CONFIG_ENV || data.splits?.[0]?.config || "default";
  if (!config) {
    throw new Error("No config available for dataset");
  }

  const splitCandidates = data.splits.filter((item) => item.config === config);
  const split = SPLIT_ENV || splitCandidates?.[0]?.split || "train";
  if (!split) {
    throw new Error("No split available for dataset");
  }

  let size = splitCandidates.find((item) => item.split === split)?.num_rows;
  if (!Number.isFinite(size)) {
    const rowsUrl = new URL(`${HF_BASE}/rows`);
    rowsUrl.searchParams.set("dataset", DATASET);
    rowsUrl.searchParams.set("config", config);
    rowsUrl.searchParams.set("split", split);
    rowsUrl.searchParams.set("offset", "0");
    rowsUrl.searchParams.set("length", "1");
    const rowsData = await fetchJson(rowsUrl.toString());
    size = rowsData.num_rows_total;
  }
  if (!Number.isFinite(size)) {
    throw new Error("Unable to determine dataset size");
  }

  cachedConfig = config;
  cachedSplit = split;
  cachedSize = size;

  return { config, split, size };
}

function pickUrlField(row) {
  if (row.contentUrl) {
    return row.contentUrl;
  }
  if (URL_FIELD_ENV && row[URL_FIELD_ENV]) {
    return row[URL_FIELD_ENV];
  }
  const keys = Object.keys(row);
  const urlKey = keys.find((key) => /url/i.test(key));
  return urlKey ? row[urlKey] : null;
}

async function fetchRandomRow() {
  const { config, split, size } = await resolveSplitInfo();
  const offset = Math.floor(Math.random() * size);

  const url = new URL(`${HF_BASE}/rows`);
  url.searchParams.set("dataset", DATASET);
  url.searchParams.set("config", config);
  url.searchParams.set("split", split);
  url.searchParams.set("offset", offset.toString());
  url.searchParams.set("length", "1");

  const data = await fetchJson(url.toString());
  const row = data.rows?.[0]?.row;
  if (!row) {
    throw new Error("No row returned from dataset");
  }

  const videoUrl = pickUrlField(row);
  if (!videoUrl) {
    throw new Error("No URL field found in dataset row");
  }

  return { url: videoUrl };
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);

  if (requestUrl.pathname === "/api/random-video") {
    try {
      const payload = await fetchRandomRow();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(payload));
    } catch (error) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  if (requestUrl.pathname === "/" || requestUrl.pathname === "/index.html") {
    const filePath = path.join(__dirname, "index.html");
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end("Failed to load index.html");
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(data);
    });
    return;
  }

  if (requestUrl.pathname === "/main.js") {
    const filePath = path.join(__dirname, "main.js");
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end("Failed to load main.js");
        return;
      }
      res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8" });
      res.end(data);
    });
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
