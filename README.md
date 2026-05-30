# PDF Search

PDFのURL配列をターゲットにして、LocalStorageに保存した検索文字列の配列で本文検索するシングルページWebアプリケーションです。

## 技術スタック

- React + Vite
- TypeScript
- Biome
- pdf.js（`pdfjs-dist`）

## セットアップ

```bash
npm install
npm run dev
```

ブラウザで表示されたローカルURLを開き、PDF URLと検索文字列を1行ずつ入力して検索します。
検索文字列は `pdf-search:terms` キーでLocalStorageにJSON配列として保存されます。

> [!NOTE]
> ブラウザからPDFを取得するため、検索対象PDFの配信元がCORSを許可している必要があります。

## スクリプト

- `npm run dev`: 開発サーバーを起動
- `npm run build`: TypeScriptチェックと本番ビルド
- `npm run lint`: Biomeチェック
- `npm run format`: Biomeフォーマット
