/* Tiny zero-dependency static file server for Railway / any Node runtime. */
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const PORT = parseInt(process.env.PORT || "3000", 10);
const HOST = process.env.HOST || "0.0.0.0";
const ROOT = path.resolve(__dirname);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8", ...headers });
  res.end(body);
};

const server = http.createServer((req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return send(res, 405, "Method Not Allowed", { allow: "GET, HEAD" });
  }

  if (req.url === "/healthz") return send(res, 200, "ok");

  let urlPath;
  try {
    urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
  } catch {
    return send(res, 400, "Bad Request");
  }

  let filePath = path.resolve(path.join(ROOT, urlPath));
  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
    return send(res, 403, "Forbidden");
  }

  fs.stat(filePath, (err, stat) => {
    if (err) return send(res, 404, "Not Found");
    if (stat.isDirectory()) filePath = path.join(filePath, "index.html");

    fs.readFile(filePath, (err2, body) => {
      if (err2) return send(res, 404, "Not Found");
      const ext = path.extname(filePath).toLowerCase();
      const type = MIME[ext] || "application/octet-stream";
      const cache = ext === ".json" || ext === ".html"
        ? "no-cache"
        : "public, max-age=300";
      const headers = { "content-type": type, "cache-control": cache };
      res.writeHead(200, headers);
      if (req.method === "HEAD") return res.end();
      res.end(body);
    });
  });
});

server.listen(PORT, HOST, () => {
  console.log(`NAV Ledger listening on http://${HOST}:${PORT}`);
});
