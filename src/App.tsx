import { useEffect, useMemo, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import type {
  ApiErrorResponse,
  PdfSearchResponse,
  PdfSearchResult,
} from '../server/types';

const PDF_URLS_STORAGE_KEY = 'pdf-search:pdf-urls';
const SEARCH_TERMS_STORAGE_KEY = 'pdf-search:terms';
const DEFAULT_PDF_URLS = [
  'https://www.kanpo.go.jp/20260519/20260519g00110/pdf/20260519g00110full00010096.pdf',
];
const DEFAULT_SEARCH_TERMS = ['浦和'];
const IMPORT_FILE_ACCEPT = '.txt,.json,.yml,.yaml,application/json,text/plain';

type SearchStatus = 'idle' | 'loading' | 'done' | 'error';
type ImportTarget = 'pdfUrls' | 'searchTerms';

type ImportPreview = {
  target: ImportTarget;
  title: string;
  fileName: string;
  validItems: string[];
  invalidItems: string[];
};

type ParsedImportFile = {
  items: string[];
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
  onFileSelect: (file: File) => void;
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
        (item): item is string =>
          typeof item === 'string' && item.trim() !== '',
      );
    }
  } catch {
    return rawValue
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return fallback;
}

function stripYamlQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function parsePlainText(content: string): ParsedImportFile {
  return {
    items: content
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean),
    invalidItems: [],
  };
}

function parseJson(content: string): ParsedImportFile {
  const parsed = JSON.parse(content) as unknown;

  if (!Array.isArray(parsed)) {
    throw new Error('JSONファイルは文字列配列で記載してください。');
  }

  const items: string[] = [];
  const invalidItems: string[] = [];

  parsed.forEach((item, index) => {
    if (typeof item === 'string' && item.trim() !== '') {
      items.push(item.trim());
      return;
    }

    invalidItems.push(`${index + 1}番目の値が文字列ではありません。`);
  });

  return { items, invalidItems };
}

function parseYaml(content: string): ParsedImportFile {
  const items: string[] = [];
  const invalidItems: string[] = [];

  content.split(/\r?\n/).forEach((line, index) => {
    const trimmedLine = line.trim();

    if (!trimmedLine || trimmedLine.startsWith('#')) {
      return;
    }

    if (!trimmedLine.startsWith('-')) {
      invalidItems.push(`${index + 1}行目: ${trimmedLine}`);
      return;
    }

    const value = stripYamlQuotes(trimmedLine.slice(1).trim());

    if (value) {
      items.push(value);
      return;
    }

    invalidItems.push(`${index + 1}行目: 空の値`);
  });

  return { items, invalidItems };
}

function parseImportFile(fileName: string, content: string): ParsedImportFile {
  const extension = fileName.toLocaleLowerCase().split('.').pop();

  switch (extension) {
    case 'txt':
      return parsePlainText(content);
    case 'json':
      return parseJson(content);
    case 'yml':
    case 'yaml':
      return parseYaml(content);
    default:
      throw new Error('対応ファイルは .txt, .json, .yml, .yaml です。');
  }
}

function validatePdfUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function dedupeItems(items: string[]): string[] {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
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
  onFileSelect,
}: ListInputProps) {
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onAdd();
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';

    if (file) {
      onFileSelect(file);
    }
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
        <button type="submit" disabled={value.trim() === ''}>
          追加
        </button>
      </form>

      <label className="file-upload-button">
        ファイルから読み込み
        <input
          type="file"
          accept={IMPORT_FILE_ACCEPT}
          onChange={handleFileChange}
        />
      </label>

      {items.length === 0 ? (
        <p className="empty-message">{emptyMessage}</p>
      ) : null}

      <ul className="item-list">
        {items.map((item, index) => (
          <li key={`${item}-${index}`} className="list-item">
            <span className="list-text">{item}</span>
            <button
              type="button"
              className="remove-button"
              onClick={() => onRemove(index)}
            >
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
  const [pdfUrlInput, setPdfUrlInput] = useState('');
  const [searchTermInput, setSearchTermInput] = useState('');
  const [results, setResults] = useState<PdfSearchResult[]>([]);
  const [status, setStatus] = useState<SearchStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [importErrorMessage, setImportErrorMessage] = useState<string | null>(
    null,
  );
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(
    null,
  );

  const canSearch = useMemo(
    () => pdfUrls.length > 0 && searchTerms.length > 0 && status !== 'loading',
    [pdfUrls.length, searchTerms.length, status],
  );

  useEffect(() => {
    window.localStorage.setItem(PDF_URLS_STORAGE_KEY, JSON.stringify(pdfUrls));
  }, [pdfUrls]);

  useEffect(() => {
    window.localStorage.setItem(
      SEARCH_TERMS_STORAGE_KEY,
      JSON.stringify(searchTerms),
    );
  }, [searchTerms]);

  function addPdfUrl() {
    const nextValue = pdfUrlInput.trim();

    if (!nextValue) {
      return;
    }

    if (!validatePdfUrl(nextValue)) {
      setImportErrorMessage('PDF URLは http(s) のURL形式で入力してください。');
      return;
    }

    if (pdfUrls.includes(nextValue)) {
      setPdfUrlInput('');
      return;
    }

    setPdfUrls((currentItems) => [...currentItems, nextValue]);
    setPdfUrlInput('');
  }

  function addSearchTerm() {
    const nextValue = searchTermInput.trim();

    if (!nextValue || searchTerms.includes(nextValue)) {
      setSearchTermInput('');
      return;
    }

    setSearchTerms((currentItems) => [...currentItems, nextValue]);
    setSearchTermInput('');
  }

  async function handleImportFile(
    target: ImportTarget,
    title: string,
    file: File,
  ) {
    setImportErrorMessage(null);

    try {
      const parsed = parseImportFile(file.name, await file.text());
      const invalidItems = [...parsed.invalidItems];
      const validItems = dedupeItems(parsed.items).filter((item) => {
        if (target !== 'pdfUrls' || validatePdfUrl(item)) {
          return true;
        }

        invalidItems.push(item);
        return false;
      });

      setImportPreview({
        target,
        title,
        fileName: file.name,
        validItems,
        invalidItems,
      });
    } catch (error) {
      setImportPreview(null);
      setImportErrorMessage(
        error instanceof Error
          ? error.message
          : 'ファイルの読み込みに失敗しました。',
      );
    }
  }

  function applyImportPreview() {
    if (!importPreview) {
      return;
    }

    if (importPreview.target === 'pdfUrls') {
      setPdfUrls((currentItems) =>
        dedupeItems([...currentItems, ...importPreview.validItems]),
      );
    } else {
      setSearchTerms((currentItems) =>
        dedupeItems([...currentItems, ...importPreview.validItems]),
      );
    }

    setImportPreview(null);
  }

  async function handleSearch() {
    if (!canSearch) {
      return;
    }

    setStatus('loading');
    setResults([]);
    setErrorMessage(null);

    try {
      const response = await fetch('/api/search', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({ pdfUrls, searchTerms }),
      });
      const payload = (await response.json()) as
        | PdfSearchResponse
        | ApiErrorResponse;

      if (!payload.ok) {
        throw new Error(payload.message);
      }

      setResults(payload.results);
      setStatus('done');
    } catch (error) {
      setStatus('error');
      setErrorMessage(
        error instanceof Error ? error.message : 'PDFの検索に失敗しました。',
      );
    }
  }

  return (
    <main className="app-shell">
      <section className="hero-card">
        <p className="eyebrow">PDF Search</p>
        <h1>PDF内の文字列をサーバー経由で検索</h1>
        <p className="description">
          ブラウザではPDF
          URLと検索語句だけを管理し、検索時はローカルサーバーがPDFを一時保存して本文検索します。
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
            setPdfUrls((currentItems) =>
              currentItems.filter((_, i) => i !== index),
            )
          }
          onFileSelect={(file) =>
            handleImportFile('pdfUrls', 'ターゲットPDF URL', file)
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
            setSearchTerms((currentItems) =>
              currentItems.filter((_, i) => i !== index),
            )
          }
          onFileSelect={(file) =>
            handleImportFile('searchTerms', '検索する文字列', file)
          }
        />
      </div>

      {importErrorMessage ? (
        <section className="panel error">{importErrorMessage}</section>
      ) : null}

      {importPreview ? (
        <section className="panel import-preview" aria-live="polite">
          <div className="import-preview-header">
            <div>
              <p className="eyebrow dark-eyebrow">File Preview</p>
              <h2>{importPreview.title}の読み込みプレビュー</h2>
              <p>
                {importPreview.fileName} から {importPreview.validItems.length}{' '}
                件を追加できます。
              </p>
            </div>
            <div className="preview-actions">
              <button
                type="button"
                disabled={importPreview.validItems.length === 0}
                onClick={applyImportPreview}
              >
                追加
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => setImportPreview(null)}
              >
                キャンセル
              </button>
            </div>
          </div>

          {importPreview.validItems.length > 0 ? (
            <ul className="preview-list">
              {importPreview.validItems.map((item, index) => (
                <li key={`${item}-${index}`}>{item}</li>
              ))}
            </ul>
          ) : (
            <p className="empty-message">追加できる値がありません。</p>
          )}

          {importPreview.invalidItems.length > 0 ? (
            <div className="invalid-items">
              <strong>読み込めなかった値</strong>
              <ul>
                {importPreview.invalidItems.map((item, index) => (
                  <li key={`${item}-${index}`}>{item}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="toolbar" aria-label="検索アクション">
        <button type="button" disabled={!canSearch} onClick={handleSearch}>
          {status === 'loading' ? '検索中…' : 'PDFを検索'}
        </button>
        <div className="summary">
          <span>PDF: {pdfUrls.length}件</span>
          <span>検索語句: {searchTerms.length}件</span>
        </div>
      </section>

      {status === 'loading' ? (
        <section className="panel progress" aria-live="polite">
          <strong>サーバーでPDFを取得・検索しています。</strong>
          <span>
            PDFが未キャッシュの場合はダウンロードに時間がかかることがあります。
          </span>
        </section>
      ) : null}

      {errorMessage ? (
        <section className="panel error">{errorMessage}</section>
      ) : null}

      <section className="panel results" aria-live="polite">
        <div className="results-header">
          <h2>検索結果</h2>
          <span>{results.length}件</span>
        </div>

        {status === 'idle' ? (
          <p>検索条件を入力して「PDFを検索」を押してください。</p>
        ) : null}
        {status === 'done' && results.length === 0 ? (
          <p>一致する文字列はありませんでした。</p>
        ) : null}

        <ol>
          {results.map((result) => (
            <li key={result.id} className="result-item">
              <div className="result-meta">
                <a
                  href={`${result.pdfUrl}#page=${result.pageNumber}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {new URL(result.pdfUrl).pathname.split('/').pop() ||
                    result.pdfUrl}
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
