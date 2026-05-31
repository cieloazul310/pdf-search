import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PdfSearchResult } from "./types";

const CACHE_DIR = path.join(tmpdir(), "pdf-search-cache");
const USER_AGENT = "pdf-search-local-server/0.1";

type NormalizedTerm = {
  label: string;
  normalized: string;
};

function normalizeList(items: string[]): string[] {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
}

function getCachePath(pdfUrl: string): string {
  const hash = createHash("sha256").update(pdfUrl).digest("hex");
  return path.join(CACHE_DIR, `${hash}.pdf`);
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const fileStats = await stat(filePath);
    return fileStats.isFile() && fileStats.size > 0;
  } catch {
    return false;
  }
}

export async function downloadPdfToCache(pdfUrl: string): Promise<string> {
  await mkdir(CACHE_DIR, { recursive: true });

  const cachePath = getCachePath(pdfUrl);

  if (await fileExists(cachePath)) {
    return cachePath;
  }

  const response = await fetch(pdfUrl, {
    headers: {
      "user-agent": USER_AGENT,
    },
  });

  if (!response.ok) {
    throw new Error(`PDFの取得に失敗しました: ${pdfUrl} (${response.status})`);
  }

  const contentType = response.headers.get("content-type") ?? "";

  if (
    !contentType.toLocaleLowerCase().includes("pdf") &&
    !pdfUrl.toLocaleLowerCase().endsWith(".pdf")
  ) {
    throw new Error(`PDFではないレスポンスを受信しました: ${pdfUrl}`);
  }

  const pdfBytes = new Uint8Array(await response.arrayBuffer());
  await writeFile(cachePath, pdfBytes);

  return cachePath;
}

function buildSnippet(text: string, matchIndex: number, termLength: number): string {
  const maxContextLength = 60;
  const start = Math.max(0, matchIndex - maxContextLength);
  const end = Math.min(text.length, matchIndex + termLength + maxContextLength);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";

  return `${prefix}${text.slice(start, end).replace(/\s+/g, " ").trim()}${suffix}`;
}

async function extractPageText(page: pdfjs.PDFPageProxy): Promise<string> {
  const textContent = await page.getTextContent();

  return textContent.items.map((item) => ("str" in item ? item.str : "")).join(" ");
}

async function searchCachedPdf(
  pdfUrl: string,
  pdfPath: string,
  searchTerms: NormalizedTerm[],
): Promise<PdfSearchResult[]> {
  const pdfBytes = new Uint8Array(await readFile(pdfPath));
  const loadingTask = pdfjs.getDocument({
    data: pdfBytes,
    cMapUrl: "./node_modules/pdfjs-dist/cmaps/",
    cMapPacked: true,
  });
  const pdf = await loadingTask.promise;
  const results: PdfSearchResult[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const pageText = await extractPageText(page);
    const normalizedPageText = pageText.toLocaleLowerCase();

    for (const term of searchTerms) {
      let matchIndex = normalizedPageText.indexOf(term.normalized);

      while (matchIndex >= 0) {
        results.push({
          id: `${pdfUrl}-${pageNumber}-${term.label}-${matchIndex}`,
          pdfUrl,
          pageNumber,
          term: term.label,
          snippet: buildSnippet(pageText, matchIndex, term.label.length),
        });

        matchIndex = normalizedPageText.indexOf(
          term.normalized,
          matchIndex + term.normalized.length,
        );
      }
    }

    page.cleanup();
  }

  await pdf.destroy();

  return results;
}

export async function searchPdfUrls(
  pdfUrlsInput: string[],
  searchTermsInput: string[],
): Promise<PdfSearchResult[]> {
  const pdfUrls = normalizeList(pdfUrlsInput);
  const searchTerms = normalizeList(searchTermsInput).map((term) => ({
    label: term,
    normalized: term.toLocaleLowerCase(),
  }));

  if (pdfUrls.length === 0) {
    throw new Error("PDF URLを1件以上入力してください。");
  }

  if (searchTerms.length === 0) {
    throw new Error("検索文字列を1件以上入力してください。");
  }

  const results: PdfSearchResult[] = [];

  for (const pdfUrl of pdfUrls) {
    const pdfPath = await downloadPdfToCache(pdfUrl);
    const pdfResults = await searchCachedPdf(pdfUrl, pdfPath, searchTerms);
    results.push(...pdfResults);
  }

  return results;
}
