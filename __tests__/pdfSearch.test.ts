import { describe, expect, it } from "vitest";
import { normalizeSearchText, searchPdfUrls } from "../server/pdfSearch";

const TARGET_PDF_URL =
  "https://www.kanpo.go.jp/20260519/20260519g00110/pdf/20260519g00110full00010096.pdf";

describe("normalizeSearchText", () => {
  it("英数字の全角・半角と大文字・小文字の差を吸収する", () => {
    expect(normalizeSearchText("ＳＣ鳥取２０２６")).toBe("sc鳥取2026");
    expect(normalizeSearchText("SC鳥取2026")).toBe("sc鳥取2026");
  });
});

describe("searchPdfUrls", () => {
  it("官報PDFから指定文字列を検索できる", async () => {
    const results = await searchPdfUrls([TARGET_PDF_URL], ["浦和"]);

    expect(results.some((result) => result.term === "浦和")).toBe(true);
  }, 60_000);
});
