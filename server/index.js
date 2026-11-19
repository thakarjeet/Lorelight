import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDirectory = resolve(projectRoot, "dist");
const port = Number(process.env.PORT ?? 4173);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be a valid TCP port.");
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(payload));
}

async function proxyBookRequest(target, response) {
  try {
    const upstream = await fetch(target, {
      signal: AbortSignal.timeout(20_000),
    });
    const body = Buffer.from(await upstream.arrayBuffer());
    response.writeHead(upstream.status, {
      "Content-Type":
        upstream.headers.get("content-type") ?? "application/octet-stream",
      "Cache-Control": "public, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(body);
  } catch (error) {
    console.error("Book data upstream request failed:", error);
    sendJson(response, 502, {
      error: "The book source is temporarily unavailable.",
    });
  }
}

function contentTypeFor(path) {
  const contentTypes = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".ico": "image/x-icon",
    ".jpeg": "image/jpeg",
    ".js": "text/javascript; charset=utf-8",
    ".jpg": "image/jpeg",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".txt": "text/plain; charset=utf-8",
    ".webp": "image/webp",
  };
  return contentTypes[extname(path).toLowerCase()] ?? "application/octet-stream";
}

async function serveFile(pathname, response) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    response.writeHead(400);
    response.end("Invalid path.");
    return;
  }

  const filePath = resolve(distDirectory, `.${decodedPath}`);
  if (!filePath.startsWith(`${distDirectory}${sep}`) && filePath !== distDirectory) {
    response.writeHead(404);
    response.end("Not found.");
    return;
  }

  let fileToServe = filePath;
  try {
    const fileInfo = await stat(fileToServe);
    if (fileInfo.isDirectory()) fileToServe = resolve(fileToServe, "index.html");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    if (decodedPath.startsWith("/assets/")) {
      response.writeHead(404);
      response.end("Not found.");
      return;
    }
    fileToServe = resolve(distDirectory, "index.html");
  }

  try {
    const body = await readFile(fileToServe);
    response.writeHead(200, {
      "Content-Type": contentTypeFor(fileToServe),
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
    });
    response.end(body);
  } catch (error) {
    console.error("Could not serve the built app:", error);
    response.writeHead(404);
    response.end("Build output not found. Run npm run build first.");
  }
}

async function handleRequest(request, response) {
  if (request.method !== "GET") {
    response.writeHead(405, { Allow: "GET" });
    response.end();
    return;
  }

  const requestUrl = new URL(
    request.url ?? "/",
    `http://${request.headers.host ?? "localhost"}`,
  );

  if (requestUrl.pathname === "/api/gutendex/") {
    const target = new URL("https://gutendex.com/books/");
    target.search = requestUrl.search;
    await proxyBookRequest(target, response);
    return;
  }

  if (requestUrl.pathname.startsWith("/api/gutenberg/")) {
    const resourcePath = requestUrl.pathname.slice("/api/gutenberg".length);
    if (
      !resourcePath.startsWith("/ebooks/") &&
      !resourcePath.startsWith("/cache/epub/")
    ) {
      sendJson(response, 404, { error: "Book resource not found." });
      return;
    }

    const target = new URL(`https://www.gutenberg.org${resourcePath}`);
    target.search = requestUrl.search;
    await proxyBookRequest(target, response);
    return;
  }

  if (requestUrl.pathname.startsWith("/api/")) {
    sendJson(response, 404, { error: "API route not found." });
    return;
  }

  await serveFile(requestUrl.pathname, response);
}

createServer((request, response) => {
  void handleRequest(request, response);
}).listen(port, "0.0.0.0", () => {
  console.log(`Lorelight is listening on port ${port}.`);
});
