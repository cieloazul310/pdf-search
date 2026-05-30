# PDF Search

PDFのURL配列をターゲットにして、LocalStorageに保存したPDF URL配列と検索文字列配列で本文検索するシングルページWebアプリケーションです。

CORSを避けるため、ブラウザは検索条件だけをローカルサーバーへ送信します。サーバーはPDFを `/tmp/pdf-search-cache`（OSの一時ディレクトリ配下）に一時保存し、保存済みPDFから文字列を検索してJSONレスポンスを返します。

## 技術スタック

- React + Vite
- TypeScript
- Biome
- Vitest
- pdf.js（`pdfjs-dist`）
- Node.js HTTP server

## セットアップ

```bash
npm install
npm run dev
```

`npm run dev` は以下を同時に起動します。

- Vite開発サーバー（クライアント）
- Node.js APIサーバー（`http://localhost:5174`）

ブラウザで表示されたローカルURLを開き、PDF URLと検索文字列をインプットから追加して検索します。

## LocalStorage

- PDF URL配列: `pdf-search:pdf-urls`
- 検索文字列配列: `pdf-search:terms`

## API

### `POST /api/search`

Request:

```json
{
  "pdfUrls": ["https://example.com/sample.pdf"],
  "searchTerms": ["検索語句"]
}
```

Response:

```json
{
  "ok": true,
  "results": [
    {
      "id": "...",
      "pdfUrl": "https://example.com/sample.pdf",
      "pageNumber": 1,
      "term": "検索語句",
      "snippet": "..."
    }
  ],
  "searchedPdfCount": 1,
  "searchedTermCount": 1
}
```

## スクリプト

- `npm run dev`: クライアントとAPIサーバーを同時起動
- `npm run client:dev`: Vite開発サーバーを起動
- `npm run server:dev`: APIサーバーをwatch起動
- `npm run build`: TypeScriptチェックと本番ビルド
- `npm run preview`: 本番ビルド後にAPIサーバーから`dist`を配信
- `npm run test`: Vitestでサーバー側テストを実行
- `npm run lint`: Biomeチェック
- `npm run format`: Biomeフォーマット
