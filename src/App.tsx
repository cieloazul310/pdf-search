import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import type { ApiErrorResponse, PdfSearchResponse, PdfSearchResult } from "../server/types";

const PDF_URLS_STORAGE_KEY = "pdf-search:pdf-urls";
const SEARCH_TERMS_STORAGE_KEY = "pdf-search:terms";
const DEFAULT_PDF_URLS = [
  "https://www.kanpo.go.jp/20260519/20260519g00110/pdf/20260519g00110full00010096.pdf",
];
const DEFAULT_SEARCH_TERMS = ["浦和"];

type SearchStatus = "idle" | "loading" | "done" | "error";

export type SupportedListFileExtension = "txt" | "json" | "yml" | "yaml";

function ensureNonEmptyList(items: string[], sourceName: string): string[] {
  if (items.length === 0) {
    throw new Error(`${sourceName}に有効な項目がありません。1件以上の文字列を指定してください。`);
  }

  return items;
}

export function getFileExtension(file: File): SupportedListFileExtension | null {
  const match = /\.([^.\/]+)$/.exec(file.name.toLowerCase());
  const extension = match?.[1];

  if (
    extension === "txt" ||
    extension === "json" ||
    extension === "yml" ||
    extension === "yaml"
  ) {
    return extension;
  }

  return null;
}

export function parseTextList(content: string): string[] {
  return ensureNonEmptyList(
    content
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean),
    "テキストファイル",
  );
}

export function parseJsonList(content: string): string[] {
  let parsed: unknown;

  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("JSONファイルの形式が不正です。文字列配列として記述してください。");
  }

  if (!Array.isArray(parsed)) {
    throw new Error("JSONファイルはトップレベルに文字列配列を指定してください。");
  }

  const invalidIndex = parsed.findIndex((item) => typeof item !== "string");

  if (invalidIndex !== -1) {
    throw new Error(`JSONファイルの${invalidIndex + 1}件目が文字列ではありません。`);
  }

  return ensureNonEmptyList(
    parsed.map((item) => item.trim()).filter(Boolean),
    "JSONファイル",
  );
}

export function parseYamlList(content: string): string[] {
  const values: string[] = [];
  const nonEmptyLines = content
    .split(/\r?\n/)
    .map((line, index) => ({ line: line.trim(), lineNumber: index + 1 }))
    .filter(({ line }) => line !== "");

  for (const { line, lineNumber } of nonEmptyLines) {
    if (line !== "-" && !line.startsWith("- ")) {
      throw new Error(
        `YAMLファイルの${lineNumber}行目が不正です。各行は「- 値」の形式で記述してください。`,
      );
    }

    const value = line.slice(1).trim();

    if (value === "") {
      throw new Error(`YAMLファイルの${lineNumber}行目に値がありません。`);
    }

    values.push(value);
  }

  return ensureNonEmptyList(values, "YAMLファイル");
}

export async function parseUploadedList(file: File): Promise<string[]> {
  const extension = getFileExtension(file);

  if (!extension) {
    throw new Error("対応していないファイル形式です。.txt、.json、.yml、.yamlを指定してください。");
  }

  const content = await file.text();

  switch (extension) {
    case "txt":
      return parseTextList(content);
    case "json":
      return parseJsonList(content);
    case "yml":
    case "yaml":
      return parseYamlList(content);
    default: {
      const exhaustiveCheck: never = extension;
      return exhaustiveCheck;
    }
  }
}

type ListInputProps = {
  title: string;
  placeholder: string;
  emptyMessage: string;
  items: string[];
  value: string;
  onValueChange: (value: string) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
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

function ListInput({
  title,
  placeholder,
  emptyMessage,
  items,
  value,
  onValueChange,
  onAdd,
  onRemove,
}: ListInputProps) {
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onAdd();
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

  const canSearch = useMemo(
    () => pdfUrls.length > 0 && searchTerms.length > 0 && status !== "loading",
    [pdfUrls.length, searchTerms.length, status],
  );

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
        />
      </div>

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
