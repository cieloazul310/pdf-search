import { useEffect, useMemo, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import type { ApiErrorResponse, PdfSearchResponse, PdfSearchResult } from "../server/types";

const PDF_URLS_STORAGE_KEY = "pdf-search:pdf-urls";
const SEARCH_TERMS_STORAGE_KEY = "pdf-search:terms";
const DEFAULT_PDF_URLS = [
  "https://www.kanpo.go.jp/20260519/20260519g00110/pdf/20260519g00110full00010096.pdf",
];
const DEFAULT_SEARCH_TERMS = ["浦和"];

type SearchStatus = "idle" | "loading" | "done" | "error";

type ImportTarget = "pdfUrls" | "searchTerms";

type ImportPreview = {
  target: ImportTarget;
  fileName: string;
  validItems: string[];
  invalidItems: string[];
};

type ListInputProps = {
  title: string;
  placeholder: string;
  emptyMessage: string;
  items: string[];
  value: string;
  onValueChange: (value: string) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
  importTarget: ImportTarget;
  onImportFile: (target: ImportTarget, file: File) => void;
};

function loadSavedList(storageKey: string, fallback: string[]): string[] {
  const rawValue = window.localStorage.getItem(storageKey);

  if (!rawValue) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(rawValue) as unknown;

    if (Array.isArray(parsed)) {
      return parsed.filter(
        (item): item is string => typeof item === "string" && item.trim() !== "",
      );
    }
  } catch {
    return rawValue
      .split("\n")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return fallback;
}

function splitDelimitedText(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((item) => item.trim().replace(/^(["'])(.*)\1$/, "$2").trim())
    .filter(Boolean);
}

function parseImportFile(fileName: string, text: string): string[] {
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";

  if (extension === "json") {
    const parsed = JSON.parse(text) as unknown;

    if (!Array.isArray(parsed)) {
      throw new Error("JSONファイルは文字列配列にしてください。");
    }

    return parsed
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean);
  }

  if (extension === "csv") {
    return splitDelimitedText(text);
  }

  if (extension === "txt" || extension === "text" || extension === "") {
    return text
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  throw new Error("対応しているファイル形式は .txt / .csv / .json です。");
}

function buildImportPreview(
  target: ImportTarget,
  fileName: string,
  rawItems: string[],
): ImportPreview {
  const validItems: string[] = [];
  const invalidItems: string[] = [];

  for (const rawItem of rawItems) {
    const item = rawItem.trim();

    if (!item) {
      continue;
    }

    if (target === "pdfUrls") {
      try {
        validItems.push(new URL(item).toString());
      } catch {
        invalidItems.push(item);
      }
      continue;
    }

    validItems.push(item);
  }

  return { target, fileName, validItems, invalidItems };
}

function getUniqueNewItems(items: string[], existingItems: string[]): string[] {
  const seenItems = new Set(existingItems);
  const uniqueItems: string[] = [];

  for (const item of items) {
    if (!seenItems.has(item)) {
      uniqueItems.push(item);
      seenItems.add(item);
    }
  }

  return uniqueItems;
}

function ListInput({
  title,
  placeholder,
  emptyMessage,
  items,
  value,
  onValueChange,
  onAdd,
  onRemove,
  importTarget,
  onImportFile,
}: ListInputProps) {
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onAdd();
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (file) {
      onImportFile(importTarget, file);
    }

    event.target.value = "";
  }

  return (
    <section className="panel list-panel">
      <h2>{title}</h2>
      <form className="add-form" onSubmit={handleSubmit}>
        <input
          type="text"
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          placeholder={placeholder}
        />
        <button type="submit" disabled={value.trim() === ""}>
          追加
        </button>
      </form>

      <label className="file-import">
        <span>ファイルから追加（.txt / .csv / .json）</span>
        <input type="file" accept=".txt,.text,.csv,.json" onChange={handleFileChange} />
      </label>

      {items.length === 0 ? <p className="empty-message">{emptyMessage}</p> : null}

      <ul className="item-list">
        {items.map((item, index) => (
          <li key={`${item}-${index}`} className="list-item">
            <span className="list-text">{item}</span>
            <button type="button" className="remove-button" onClick={() => onRemove(index)}>
              削除
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function App() {
  const [pdfUrls, setPdfUrls] = useState(() =>
    loadSavedList(PDF_URLS_STORAGE_KEY, DEFAULT_PDF_URLS),
  );
  const [searchTerms, setSearchTerms] = useState(() =>
    loadSavedList(SEARCH_TERMS_STORAGE_KEY, DEFAULT_SEARCH_TERMS),
  );
  const [pdfUrlInput, setPdfUrlInput] = useState("");
  const [searchTermInput, setSearchTermInput] = useState("");
  const [results, setResults] = useState<PdfSearchResult[]>([]);
  const [status, setStatus] = useState<SearchStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const canSearch = useMemo(
    () => pdfUrls.length > 0 && searchTerms.length > 0 && status !== "loading",
    [pdfUrls.length, searchTerms.length, status],
  );
  const importPreviewExistingItems =
    importPreview?.target === "pdfUrls" ? pdfUrls : importPreview ? searchTerms : [];
  const importPreviewAddableItems = importPreview
    ? getUniqueNewItems(importPreview.validItems, importPreviewExistingItems)
    : [];
  const importPreviewDuplicateCount = importPreview
    ? importPreview.validItems.length - importPreviewAddableItems.length
    : 0;
  const importTargetLabel = importPreview?.target === "pdfUrls" ? "PDF URL" : "検索語句";

  useEffect(() => {
    window.localStorage.setItem(PDF_URLS_STORAGE_KEY, JSON.stringify(pdfUrls));
  }, [pdfUrls]);

  useEffect(() => {
    window.localStorage.setItem(SEARCH_TERMS_STORAGE_KEY, JSON.stringify(searchTerms));
  }, [searchTerms]);

  function addPdfUrl() {
    const nextValue = pdfUrlInput.trim();

    if (!nextValue || pdfUrls.includes(nextValue)) {
      setPdfUrlInput("");
      return;
    }

    setPdfUrls((currentItems) => [...currentItems, nextValue]);
    setPdfUrlInput("");
  }

  function addSearchTerm() {
    const nextValue = searchTermInput.trim();

    if (!nextValue || searchTerms.includes(nextValue)) {
      setSearchTermInput("");
      return;
    }

    setSearchTerms((currentItems) => [...currentItems, nextValue]);
    setSearchTermInput("");
  }

  async function handleImportFile(target: ImportTarget, file: File) {
    setImportError(null);

    try {
      const text = await file.text();
      const rawItems = parseImportFile(file.name, text);
      setImportPreview(buildImportPreview(target, file.name, rawItems));
    } catch (error) {
      setImportPreview(null);
      setImportError(
        error instanceof Error ? error.message : "ファイルの読み込みまたは解析に失敗しました。",
      );
    }
  }

  function confirmImportPreview() {
    if (!importPreview) {
      return;
    }

    if (importPreview.target === "pdfUrls") {
      setPdfUrls((currentItems) => [
        ...currentItems,
        ...getUniqueNewItems(importPreview.validItems, currentItems),
      ]);
    } else {
      setSearchTerms((currentItems) => [
        ...currentItems,
        ...getUniqueNewItems(importPreview.validItems, currentItems),
      ]);
    }

    setImportPreview(null);
  }

  function cancelImportPreview() {
    setImportPreview(null);
  }

  async function handleSearch() {
    if (!canSearch) {
      return;
    }

    setStatus("loading");
    setResults([]);
    setErrorMessage(null);

    try {
      const response = await fetch("/api/search", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ pdfUrls, searchTerms }),
      });
      const payload = (await response.json()) as PdfSearchResponse | ApiErrorResponse;

      if (!payload.ok) {
        throw new Error(payload.message);
      }

      setResults(payload.results);
      setStatus("done");
    } catch (error) {
      setStatus("error");
      setErrorMessage(error instanceof Error ? error.message : "PDFの検索に失敗しました。");
    }
  }

  return (
    <main className="app-shell">
      <section className="hero-card">
        <p className="eyebrow">PDF Search</p>
        <h1>PDF内の文字列をサーバー経由で検索</h1>
        <p className="description">
          ブラウザではPDF URLと検索語句だけを管理し、検索時はローカルサーバーがPDFを一時保存して本文検索します。
        </p>
      </section>

      <div className="input-grid" aria-label="検索条件">
        <ListInput
          title="ターゲットPDF URL"
          placeholder="https://example.com/sample.pdf"
          emptyMessage="検索対象のPDF URLを追加してください。"
          items={pdfUrls}
          value={pdfUrlInput}
          onValueChange={setPdfUrlInput}
          onAdd={addPdfUrl}
          onRemove={(index) =>
            setPdfUrls((currentItems) => currentItems.filter((_, i) => i !== index))
          }
          importTarget="pdfUrls"
          onImportFile={handleImportFile}
        />

        <ListInput
          title="検索する文字列"
          placeholder="検索語句"
          emptyMessage="検索する文字列を追加してください。"
          items={searchTerms}
          value={searchTermInput}
          onValueChange={setSearchTermInput}
          onAdd={addSearchTerm}
          onRemove={(index) =>
            setSearchTerms((currentItems) => currentItems.filter((_, i) => i !== index))
          }
          importTarget="searchTerms"
          onImportFile={handleImportFile}
        />
      </div>

      {importError ? <section className="panel error">{importError}</section> : null}

      {importPreview ? (
        <section className="panel import-preview" aria-live="polite">
          <div className="results-header">
            <div>
              <p className="eyebrow import-eyebrow">Import preview</p>
              <h2>{importTargetLabel}の追加プレビュー</h2>
            </div>
            <span>{importPreview.fileName}</span>
          </div>

          <div className="preview-summary">
            <span>追加予定: {importPreviewAddableItems.length}件</span>
            <span>重複除外予定: {importPreviewDuplicateCount}件</span>
            {importPreview.target === "pdfUrls" ? (
              <span>無効URL: {importPreview.invalidItems.length}件</span>
            ) : null}
          </div>

          {importPreviewAddableItems.length > 0 ? (
            <div className="preview-block">
              <h3>追加対象</h3>
              <ul className="preview-list">
                {importPreviewAddableItems.slice(0, 10).map((item, index) => (
                  <li key={`${item}-${index}`}>{item}</li>
                ))}
              </ul>
              {importPreviewAddableItems.length > 10 ? (
                <p className="empty-message">ほか {importPreviewAddableItems.length - 10}件</p>
              ) : null}
            </div>
          ) : (
            <p className="empty-message">追加できる新規項目はありません。</p>
          )}

          {importPreview.target === "pdfUrls" && importPreview.invalidItems.length > 0 ? (
            <div className="preview-block invalid-preview">
              <h3>無効URL一覧</h3>
              <ul className="preview-list">
                {importPreview.invalidItems.map((item, index) => (
                  <li key={`${item}-${index}`}>{item}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="preview-actions">
            <button
              type="button"
              onClick={confirmImportPreview}
              disabled={importPreviewAddableItems.length === 0}
            >
              追加
            </button>
            <button type="button" className="secondary-button" onClick={cancelImportPreview}>
              キャンセル
            </button>
          </div>
        </section>
      ) : null}

      <section className="toolbar" aria-label="検索アクション">
        <button type="button" disabled={!canSearch} onClick={handleSearch}>
          {status === "loading" ? "検索中…" : "PDFを検索"}
        </button>
        <div className="summary">
          <span>PDF: {pdfUrls.length}件</span>
          <span>検索語句: {searchTerms.length}件</span>
        </div>
      </section>

      {status === "loading" ? (
        <section className="panel progress" aria-live="polite">
          <strong>サーバーでPDFを取得・検索しています。</strong>
          <span>PDFが未キャッシュの場合はダウンロードに時間がかかることがあります。</span>
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
                <a
                  href={`${result.pdfUrl}#page=${result.pageNumber}`}
                  target="_blank"
                  rel="noreferrer"
                >
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
