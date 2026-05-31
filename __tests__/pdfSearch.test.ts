import { describe, expect, it } from "vitest";
import { searchPdfUrls } from "../server/pdfSearch";

const TARGET_PDF_URL =
  "https://www.kanpo.go.jp/20260519/20260519g00110/pdf/20260519g00110full00010096.pdf";

describe("searchPdfUrls", () => {
  it("官報PDFから指定文字列を検索できる", async () => {
    const results = await searchPdfUrls([TARGET_PDF_URL], ["浦和"]);

    expect(results.some((result) => result.term === "浦和")).toBe(true);
  }, 60_000);
});
