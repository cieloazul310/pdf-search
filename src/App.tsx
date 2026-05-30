import { useEffect, useMemo, useState } from "react";
import * as pdfjs from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const SEARCH_TERMS_STORAGE_KEY = "pdf-search:terms";
const DEFAULT_PDF_URLS = [
  "https://mozilla.github.io/pdf.js/web/compressed.tracemonkey-pldi-09.pdf",
];

type SearchStatus = "idle" | "loading" | "done" | "error";

type PdfSearchResult = {
  id: string;
  pdfUrl: string;
  pageNumber: number;
  term: string;
  snippet: string;
};

type PdfSearchProgress = {
  currentUrl: string;
  loadedPages: number;
  totalPages: number;
};

function parseList(value: string): string[] {
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

function createTextAreaValue(items: string[]): string {
  return items.join("\n");
}

function loadSavedSearchTerms(): string[] {
  const rawValue = window.localStorage.getItem(SEARCH_TERMS_STORAGE_KEY);

  if (!rawValue) {
    return ["trace", "JavaScript"];
  }

  try {
    const parsed = JSON.parse(rawValue) as unknown;

    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === "string");
    }
  } catch {
    return parseList(rawValue);
  }

  return [];
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

  return textContent.items
    .map((item) => ("str" in item ? item.str : ""))
    .join(" ");
}

async function searchPdf(
  pdfUrl: string,
  searchTerms: string[],
  onProgress: (progress: PdfSearchProgress) => void,
): Promise<PdfSearchResult[]> {
  const loadingTask = pdfjs.getDocument(pdfUrl);
  const pdf = await loadingTask.promise;
  const results: PdfSearchResult[] = [];
  const normalizedTerms = searchTerms.map((term) => ({
    label: term,
    normalized: term.toLocaleLowerCase(),
  }));

  onProgress({ currentUrl: pdfUrl, loadedPages: 0, totalPages: pdf.numPages });

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const pageText = await extractPageText(page);
    const normalizedPageText = pageText.toLocaleLowerCase();

    for (const term of normalizedTerms) {
      let matchIndex = normalizedPageText.indexOf(term.normalized);

      while (matchIndex >= 0) {
        results.push({
          id: `${pdfUrl}-${pageNumber}-${term.label}-${matchIndex}`,
          pdfUrl,
          pageNumber,
          term: term.label,
          snippet: buildSnippet(pageText, matchIndex, term.label.length),
        });

        matchIndex = normalizedPageText.indexOf(term.normalized, matchIndex + term.normalized.length);
      }
    }

    onProgress({ currentUrl: pdfUrl, loadedPages: pageNumber, totalPages: pdf.numPages });
    page.cleanup();
  }

  await pdf.destroy();

  return results;
}

export default function App() {
  const [pdfUrlsInput, setPdfUrlsInput] = useState(createTextAreaValue(DEFAULT_PDF_URLS));
  const [searchTermsInput, setSearchTermsInput] = useState(() =>
    createTextAreaValue(loadSavedSearchTerms()),
  );
  const [results, setResults] = useState<PdfSearchResult[]>([]);
  const [status, setStatus] = useState<SearchStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [progress, setProgress] = useState<PdfSearchProgress | null>(null);

  const pdfUrls = useMemo(() => parseList(pdfUrlsInput), [pdfUrlsInput]);
  const searchTerms = useMemo(() => parseList(searchTermsInput), [searchTermsInput]);

  useEffect(() => {
    window.localStorage.setItem(SEARCH_TERMS_STORAGE_KEY, JSON.stringify(searchTerms));
  }, [searchTerms]);

  const canSearch = pdfUrls.length > 0 && searchTerms.length > 0 && status !== "loading";

  async function handleSearch() {
    if (!canSearch) {
      return;
    }

    setStatus("loading");
    setResults([]);
    setErrorMessage(null);

    try {
      const collectedResults: PdfSearchResult[] = [];

      for (const pdfUrl of pdfUrls) {
        const pdfResults = await searchPdf(pdfUrl, searchTerms, setProgress);
        collectedResults.push(...pdfResults);
      }

      setResults(collectedResults);
      setStatus("done");
      setProgress(null);
    } catch (error) {
      setStatus("error");
      setProgress(null);
      setErrorMessage(error instanceof Error ? error.message : "PDFの検索に失敗しました。");
    }
  }

  return (
    <main className="app-shell">
      <section className="hero-card">
        <p className="eyebrow">PDF Search</p>
        <h1>PDF内の文字列をまとめて検索</h1>
        <p className="description">
          URLで指定した複数のPDFから、LocalStorageに保存される検索文字列の配列を使って一致箇所を抽出します。
        </p>
      </section>

      <section className="panel input-grid" aria-label="検索条件">
        <label className="field">
          <span>ターゲットPDF URL（1行に1つ）</span>
          <textarea
            value={pdfUrlsInput}
            onChange={(event) => setPdfUrlsInput(event.target.value)}
            placeholder="https://example.com/sample.pdf"
            rows={7}
          />
        </label>

        <label className="field">
          <span>検索する文字列（1行に1つ / LocalStorage保存）</span>
          <textarea
            value={searchTermsInput}
            onChange={(event) => setSearchTermsInput(event.target.value)}
            placeholder="検索語句"
            rows={7}
          />
        </label>
      </section>

      <section className="toolbar" aria-label="検索アクション">
        <button type="button" disabled={!canSearch} onClick={handleSearch}>
          {status === "loading" ? "検索中…" : "PDFを検索"}
        </button>
        <div className="summary">
          <span>PDF: {pdfUrls.length}件</span>
          <span>検索語句: {searchTerms.length}件</span>
        </div>
      </section>

      {progress ? (
        <section className="panel progress" aria-live="polite">
          <strong>検索中:</strong> {progress.currentUrl}
          <progress value={progress.loadedPages} max={progress.totalPages} />
          <span>
            {progress.loadedPages} / {progress.totalPages} ページ
          </span>
        </section>
      ) : null}

      {errorMessage ? <section className="panel error">{errorMessage}</section> : null}

      <section className="panel results" aria-live="polite">
        <div className="results-header">
          <h2>検索結果</h2>
          <span>{results.length}件</span>
        </div>

        {status === "idle" ? <p>検索条件を入力して「PDFを検索」を押してください。</p> : null}
        {status === "done" && results.length === 0 ? <p>一致する文字列はありませんでした。</p> : null}

        <ol>
          {results.map((result) => (
            <li key={result.id} className="result-item">
              <div className="result-meta">
                <a href={`${result.pdfUrl}#page=${result.pageNumber}`} target="_blank" rel="noreferrer">
                  {new URL(result.pdfUrl).pathname.split("/").pop() || result.pdfUrl}
                </a>
                <span>page {result.pageNumber}</span>
                <mark>{result.term}</mark>
              </div>
              <p>{result.snippet}</p>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
