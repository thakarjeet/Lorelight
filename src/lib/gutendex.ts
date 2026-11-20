import { Capacitor } from "@capacitor/core";

export interface BookAuthor {
  name: string;
  birth_year: number | null;
  death_year: number | null;
}

export interface Book {
  id: number;
  title: string;
  authors: BookAuthor[];
  summaries: string[];
  subjects: string[];
  bookshelves: string[];
  languages: string[];
  copyright: boolean | null;
  formats: Record<string, string>;
  download_count: number;
}

export interface BookQuery {
  search: string;
  page?: number;
}

export interface BookPage {
  books: Book[];
  nextPage: number | null;
}

export function getBookAssetUrl(url: string): string {
  const source = new URL(url);
  if (
    source.origin !== "https://www.gutenberg.org" ||
    Capacitor.isNativePlatform()
  ) {
    return url;
  }
  return `/api/gutenberg${source.pathname}${source.search}`;
}

function isBook(value: unknown): value is Book {
  if (!value || typeof value !== "object") return false;
  const book = value as Partial<Book>;
  return (
    typeof book.id === "number" &&
    typeof book.title === "string" &&
    Array.isArray(book.authors) &&
    book.authors.every(
      (author) =>
        author &&
        typeof author === "object" &&
        typeof author.name === "string",
    ) &&
    Array.isArray(book.summaries) &&
    Array.isArray(book.subjects) &&
    Array.isArray(book.bookshelves) &&
    typeof book.formats === "object" &&
    book.formats !== null &&
    Object.values(book.formats).every((format) => typeof format === "string")
  );
}

function isGeneralReading(book: Book): boolean {
  const catalogText = [book.title, ...book.subjects, ...book.bookshelves]
    .join(" ")
    .toLowerCase();
  const excludedTerms = [
    "encyclopedia",
    "encyclopaedia",
    "dictionary",
    "dictionaries",
    "textbook",
    "study and teaching",
    "study guides",
    "school books",
    "reference",
    "manuals",
    "handbooks",
    "grammar",
  ];
  const hasPlainText =
    typeof book.formats["text/plain; charset=utf-8"] === "string" ||
    typeof book.formats["text/plain"] === "string";

  return (
    book.copyright === false &&
    hasPlainText &&
    !excludedTerms.some((term) => catalogText.includes(term))
  );
}

export async function fetchBooks(
  query: BookQuery,
  signal: AbortSignal,
): Promise<BookPage> {
  const url = Capacitor.isNativePlatform()
    ? new URL("https://gutendex.com/books/")
    : new URL("/api/gutendex/", window.location.origin);
  url.searchParams.set("languages", "en");
  url.searchParams.set("sort", "popular");
  if (query.page && query.page > 1) {
    url.searchParams.set("page", String(query.page));
  }
  if (query.search.trim()) {
    url.searchParams.set("search", query.search.trim());
  }

  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`The book catalog returned an error (${response.status}).`);
  }
  if (!response.headers.get("content-type")?.includes("application/json")) {
    throw new Error("The book catalog did not return JSON data.");
  }

  const payload: unknown = await response.json();
  if (
    !payload ||
    typeof payload !== "object" ||
    !("results" in payload) ||
    !Array.isArray(payload.results)
  ) {
    throw new Error("The book catalog returned data in an unexpected format.");
  }

  const nextUrl =
    "next" in payload && typeof payload.next === "string"
      ? new URL(payload.next)
      : null;
  const pageValue = nextUrl?.searchParams.get("page");
  const parsedPage = pageValue ? Number(pageValue) : NaN;

  return {
    books: payload.results.filter(isBook).filter(isGeneralReading),
    nextPage:
      Number.isSafeInteger(parsedPage) && parsedPage > 1 ? parsedPage : null,
  };
}

export function getBookTextUrl(book: Book): string | undefined {
  return (
    book.formats["text/plain; charset=utf-8"] ??
    book.formats["text/plain"]
  );
}

export function getBookSourceUrl(book: Book): string {
  return book.formats["text/html"] ?? `https://www.gutenberg.org/ebooks/${book.id}`;
}

export function extractBookText(text: string): string {
  const startMarker = text.indexOf("*** START OF THE PROJECT GUTENBERG");
  const endMarker = text.lastIndexOf("*** END OF THE PROJECT GUTENBERG");
  const markerLineEnd =
    startMarker >= 0 ? text.indexOf("\n", startMarker) : -1;
  const start = markerLineEnd >= 0 ? markerLineEnd + 1 : 0;
  const end = endMarker > start ? endMarker : text.length;

  return text.slice(start, end).trim();
}

export function paginateBook(text: string, pageSize = 1900): string[][] {
  const paragraphs = text
    .replace(/\r/g, "")
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  const pages: string[][] = [];
  let page: string[] = [];
  let pageLength = 0;

  for (const originalParagraph of paragraphs) {
    let remaining = originalParagraph;
    while (remaining.length > 0) {
      const available = pageSize - pageLength - (page.length ? 1 : 0);
      if (available <= 0) {
        pages.push(page);
        page = [];
        pageLength = 0;
        continue;
      }

      let end = Math.min(remaining.length, available);
      if (end < remaining.length) {
        const boundary = remaining.lastIndexOf(" ", end);
        if (boundary > 0) end = boundary;
      }

      const paragraph = remaining.slice(0, end).trim();
      if (paragraph) {
        page.push(paragraph);
        pageLength += paragraph.length;
      }
      remaining = remaining.slice(end).trimStart();

      if (remaining.length > 0) {
        pages.push(page);
        page = [];
        pageLength = 0;
      }
    }

    if (page.length && pageLength >= pageSize) {
      pages.push(page);
      page = [];
      pageLength = 0;
    }
  }

  if (page.length) pages.push(page);
  return pages;
}
