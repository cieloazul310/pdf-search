export type PdfSearchRequest = {
  pdfUrls: string[];
  searchTerms: string[];
};

export type PdfSearchResult = {
  id: string;
  pdfUrl: string;
  pageNumber: number;
  term: string;
  snippet: string;
};

export type PdfSearchResponse = {
  ok: true;
  results: PdfSearchResult[];
  searchedPdfCount: number;
  searchedTermCount: number;
};

export type ApiErrorResponse = {
  ok: false;
  message: string;
};
