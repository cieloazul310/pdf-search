import { createReadStream, existsSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";
import { searchPdfUrls } from "./pdfSearch";
import type { ApiErrorResponse, PdfSearchRequest, PdfSearchResponse } from "./types";

const PORT = Number.parseInt(process.env.PORT ?? "5174", 10);
const DIST_DIR = join(process.cwd(), "dist");

const mimeTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function sendJson(
  response: ServerResponse,
  statusCode: number,
  payload: PdfSearchResponse | ApiErrorResponse,
) {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const rawBody = Buffer.concat(chunks).toString("utf8");
  return rawBody ? JSON.parse(rawBody) : null;
}

function isPdfSearchRequest(payload: unknown): payload is PdfSearchRequest {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const candidate = payload as Partial<PdfSearchRequest>;

  return (
    Array.isArray(candidate.pdfUrls) &&
    candidate.pdfUrls.every((item) => typeof item === "string") &&
    Array.isArray(candidate.searchTerms) &&
    candidate.searchTerms.every((item) => typeof item === "string")
  );
}

async function handleSearch(request: IncomingMessage, response: ServerResponse) {
  if (request.method !== "POST") {
    sendJson(response, 405, { ok: false, message: "POSTメソッドでリクエストしてください。" });
    return;
  }

  try {
    const payload = await readJsonBody(request);

    if (!isPdfSearchRequest(payload)) {
      sendJson(response, 400, { ok: false, message: "pdfUrlsとsearchTermsの配列が必要です。" });
      return;
    }

    const results = await searchPdfUrls(payload.pdfUrls, payload.searchTerms);

    sendJson(response, 200, {
      ok: true,
      results,
      searchedPdfCount: payload.pdfUrls.length,
      searchedTermCount: payload.searchTerms.length,
    });
  } catch (error) {
    sendJson(response, 500, {
      ok: false,
      message: error instanceof Error ? error.message : "検索処理に失敗しました。",
    });
  }
}

function serveStatic(request: IncomingMessage, response: ServerResponse): boolean {
  if (!existsSync(DIST_DIR) || !request.url) {
    return false;
  }

  const requestPath = new URL(request.url, `http://${request.headers.host}`).pathname;
  const normalizedPath = normalize(requestPath).replace(/^\/+/, "");
  const filePath = join(DIST_DIR, normalizedPath || "index.html");
  const safeFilePath =
    filePath.startsWith(DIST_DIR) && existsSync(filePath)
      ? filePath
      : join(DIST_DIR, "index.html");

  if (!existsSync(safeFilePath)) {
    return false;
  }

  response.writeHead(200, {
    "content-type": mimeTypes[extname(safeFilePath)] ?? "application/octet-stream",
  });
  createReadStream(safeFilePath).pipe(response);

  return true;
}

const server = createServer(async (request, response) => {
  if (request.url?.startsWith("/api/search")) {
    await handleSearch(request, response);
    return;
  }

  if (serveStatic(request, response)) {
    return;
  }

  sendJson(response, 404, { ok: false, message: "Not found" });
});

server.listen(PORT, () => {
  console.log(`PDF search server listening on http://localhost:${PORT}`);
});
