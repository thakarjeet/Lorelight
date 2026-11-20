import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type TouchEvent,
} from "react";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Bookmark,
  Check,
  ChevronLeft,
  ChevronRight,
  Coffee,
  Download,
  Heart,
  LibraryBig,
  LoaderCircle,
  Moon,
  Plus,
  Search,
  Sparkles,
  Sun,
  X,
} from "lucide-react";
import {
  extractBookText,
  fetchBooks,
  getBookAssetUrl,
  getBookSourceUrl,
  getBookTextUrl,
  paginateBook,
  type Book,
} from "./lib/gutendex";
import {
  getReadingProgress,
  getSavedBookText,
  saveBookText,
  saveReadingProgress,
} from "./lib/book-store";

const genres = [
  { label: "Everything", topic: "" },
  { label: "Fiction", topic: "fiction" },
  { label: "Thriller", topic: "thriller" },
  { label: "Detective", topic: "detective" },
  { label: "Romance", topic: "romance" },
  { label: "Adventure", topic: "adventure" },
  { label: "Social", topic: "social" },
  { label: "Real life", topic: "biography" },
];

type View = "discover" | "shelf";
type ReaderTheme = "paper" | "night" | "sepia";

const shelfStorageKey = "lorelight:shelf";
const genreTerms: Record<string, string[]> = {
  fiction: ["fiction", "novels", "short stories", "plays"],
  thriller: ["thriller", "mystery", "gothic fiction", "horror", "crime"],
  detective: ["detective", "mystery", "crime"],
  romance: ["romance", "love stories", "courtship"],
  adventure: ["adventure", "voyages", "travel writing"],
  social: ["social fiction", "social classes -- fiction", "society -- fiction"],
  biography: ["biography", "autobiography", "memoirs", "memoir"],
};

interface DeferredInstallPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

function getReaderPageSize(fontSize: number): number {
  const width = Math.max(220, window.innerWidth - 60);
  const height = Math.max(280, window.innerHeight - 250);
  return Math.max(
    320,
    Math.min(1900, Math.floor(width * height * 0.003 * (18 / fontSize))),
  );
}

function isBook(value: unknown): value is Book {
  if (!value || typeof value !== "object") return false;
  const book = value as Partial<Book>;
  return (
    typeof book.id === "number" &&
    typeof book.title === "string" &&
    Array.isArray(book.authors) &&
    typeof book.formats === "object" &&
    book.formats !== null
  );
}

function readShelf(): Book[] {
  try {
    const stored = window.localStorage.getItem(shelfStorageKey);
    if (!stored) return [];
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed.filter(isBook) : [];
  } catch (error) {
    console.error("Could not restore the saved shelf.", error);
    return [];
  }
}

function authorName(book: Book): string {
  const author = book.authors[0]?.name ?? "Unknown author";
  const [last, first] = author.split(", ");
  return first ? `${first} ${last}` : author;
}

function categoryName(book: Book): string {
  const category = book.bookshelves.find((shelf) =>
    shelf.startsWith("Category:"),
  );
  return category?.replace("Category:", "").trim() ?? "A classic to discover";
}

function matchesGenre(book: Book, topic: string): boolean {
  if (!topic) return true;
  const catalogText = [...book.subjects, ...book.bookshelves]
    .join(" ")
    .toLowerCase();
  return (genreTerms[topic] ?? []).some((term) => catalogText.includes(term));
}

function formatDownloads(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}m`;
  if (count >= 1_000) return `${Math.round(count / 1_000)}k`;
  return `${count}`;
}

function App() {
  const [view, setView] = useState<View>("discover");
  const [activeGenre, setActiveGenre] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [catalog, setCatalog] = useState<Book[]>([]);
  const [nextPage, setNextPage] = useState<number | null>(null);
  const [savedBooks, setSavedBooks] = useState<Book[]>(readShelf);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [loadMoreError, setLoadMoreError] = useState("");
  const [retry, setRetry] = useState(0);
  const [selectedBook, setSelectedBook] = useState<Book | null>(null);
  const [readerText, setReaderText] = useState("");
  const [loadedBookId, setLoadedBookId] = useState<number | null>(null);
  const [readerError, setReaderError] = useState("");
  const [readerRetry, setReaderRetry] = useState(0);
  const [offlineStatus, setOfflineStatus] = useState<
    "checking" | "saved" | "saving" | "unavailable"
  >("checking");
  const [isReaderLoading, setIsReaderLoading] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);
  const [readerTheme, setReaderTheme] = useState<ReaderTheme>("paper");
  const [fontSize, setFontSize] = useState(18);
  const [readerPageSize, setReaderPageSize] = useState(() =>
    getReaderPageSize(18),
  );
  const [installPrompt, setInstallPrompt] =
    useState<DeferredInstallPrompt | null>(null);
  const loadMoreController = useRef<AbortController | null>(null);
  const readerStageRef = useRef<HTMLDivElement>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const readerPageSizeRef = useRef(readerPageSize);
  readerPageSizeRef.current = readerPageSize;

  useEffect(() => {
    function updatePageSize() {
      setReaderPageSize(getReaderPageSize(fontSize));
    }

    window.addEventListener("resize", updatePageSize);
    window.addEventListener("orientationchange", updatePageSize);
    return () => {
      window.removeEventListener("resize", updatePageSize);
      window.removeEventListener("orientationchange", updatePageSize);
    };
  }, [fontSize]);

  useEffect(() => {
    function captureInstallPrompt(event: Event) {
      event.preventDefault();
      setInstallPrompt(event as DeferredInstallPrompt);
    }

    window.addEventListener("beforeinstallprompt", captureInstallPrompt);
    return () =>
      window.removeEventListener("beforeinstallprompt", captureInstallPrompt);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let didTimeout = false;
    const timeoutId = window.setTimeout(() => {
      didTimeout = true;
      controller.abort();
    }, 20_000);
    setIsLoading(true);
    setIsLoadingMore(false);
    setNextPage(null);
    setLoadError("");
    setLoadMoreError("");

    fetchBooks({ search: searchTerm }, controller.signal)
      .then((result) => {
        setCatalog(result.books);
        setNextPage(result.nextPage);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted && !didTimeout) return;
        const message =
          error instanceof Error ? error.message : "The catalog could not load.";
        setLoadError(
          didTimeout
            ? "The catalog is taking longer than usual to respond."
            : message,
        );
      })
      .finally(() => {
        window.clearTimeout(timeoutId);
        if (!controller.signal.aborted || didTimeout) setIsLoading(false);
      });

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
      loadMoreController.current?.abort();
    };
  }, [retry, searchTerm]);

  useEffect(() => {
    try {
      window.localStorage.setItem(shelfStorageKey, JSON.stringify(savedBooks));
    } catch (error) {
      console.error("Could not save your shelf on this device.", error);
    }
  }, [savedBooks]);

  useEffect(() => {
    if (!selectedBook) return;
    const book = selectedBook;
    const controller = new AbortController();
    let didTimeout = false;
    const timeoutId = window.setTimeout(() => {
      didTimeout = true;
      controller.abort();
    }, 90_000);
    const textUrl = getBookTextUrl(book);

    setReaderText("");
    setLoadedBookId(null);
    setReaderError("");
    setOfflineStatus("checking");
    setIsReaderLoading(Boolean(textUrl));

    if (!textUrl) {
      setReaderError("This edition does not have an in-app text format yet.");
      return () => {
        window.clearTimeout(timeoutId);
        controller.abort();
      };
    }
    const readerSourceUrl = getBookAssetUrl(textUrl);

    async function loadReaderBook() {
      let text: string | undefined;
      let isCached = false;

      try {
        text = await getSavedBookText(book.id);
        isCached = Boolean(text);
      } catch (error) {
        if (controller.signal.aborted) return;
        console.error("Could not check the offline book shelf.", error);
        setOfflineStatus("unavailable");
      }

      if (controller.signal.aborted) return;

      if (!text) {
        const response = await fetch(readerSourceUrl, { signal: controller.signal });
        if (!response.ok) {
          throw new Error(`The book text could not be opened (${response.status}).`);
        }
        if (!response.headers.get("content-type")?.includes("text/plain")) {
          throw new Error("The book source did not return plain text.");
        }
        text = await response.text();
      }

      const content = extractBookText(text);
      if (!content) throw new Error("This edition does not contain readable text.");
      if (controller.signal.aborted) return;

      let restoredPage = 0;
      try {
        restoredPage = await getReadingProgress(book.id);
      } catch (error) {
        if (!controller.signal.aborted) {
          console.error("Could not restore reading progress.", error);
        }
      }

      if (controller.signal.aborted) return;

      const pageCount = paginateBook(content, readerPageSizeRef.current).length;
      setPageIndex(Math.max(0, Math.min(restoredPage, pageCount - 1)));
      setReaderText(content);
      setLoadedBookId(book.id);
      setOfflineStatus(isCached ? "saved" : "saving");

      if (!isCached) {
        try {
          await saveBookText(book.id, text);
          if (!controller.signal.aborted) setOfflineStatus("saved");
        } catch (error) {
          if (controller.signal.aborted) return;
          console.error("This book could not be saved for offline reading.", error);
          setOfflineStatus("unavailable");
        }
      }
    }

    loadReaderBook()
      .catch((error: unknown) => {
        if (controller.signal.aborted && !didTimeout) return;
        const message =
          error instanceof Error
            ? error.message
            : "The book text could not be opened.";
        setReaderError(
          didTimeout
            ? "This edition is taking longer than usual to open."
            : message.includes("Failed to fetch")
                ? "This edition could not be loaded in the reader right now."
              : message,
        );
      })
      .finally(() => {
        window.clearTimeout(timeoutId);
        if (!controller.signal.aborted || didTimeout) setIsReaderLoading(false);
      });

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [readerRetry, selectedBook]);

  const pages = useMemo(
    () => paginateBook(readerText, readerPageSize),
    [readerPageSize, readerText],
  );

  useEffect(() => {
    if (!selectedBook || loadedBookId !== selectedBook.id || pages.length === 0) {
      return;
    }

    setPageIndex((current) => Math.min(current, pages.length - 1));
  }, [loadedBookId, pages.length, selectedBook]);

  useEffect(() => {
    if (!selectedBook || loadedBookId !== selectedBook.id) return;

    saveReadingProgress(selectedBook.id, pageIndex).catch((error: unknown) => {
      console.error("Could not save reading progress.", error);
    });
  }, [loadedBookId, pageIndex, selectedBook]);

  const featuredBook = catalog[0];
  const visibleBooks =
    view === "shelf"
      ? savedBooks.filter((book) => {
          const term = searchTerm.toLowerCase();
          return (
            !term ||
            book.title.toLowerCase().includes(term) ||
            authorName(book).toLowerCase().includes(term)
          );
        })
      : catalog.filter((book) => matchesGenre(book, activeGenre));

  function openBook(book: Book) {
    setReaderTheme("paper");
    setFontSize(18);
    setPageIndex(0);
    setReaderRetry(0);
    setSelectedBook(book);
  }

  async function closeReader() {
    if (selectedBook && loadedBookId === selectedBook.id) {
      try {
        await saveReadingProgress(selectedBook.id, pageIndex);
      } catch (error) {
        console.error("Could not save reading progress before closing.", error);
      }
    }

    setSelectedBook(null);
    setReaderText("");
    setLoadedBookId(null);
    setReaderError("");
  }

  function toggleSaved(book: Book) {
    setSavedBooks((current) =>
      current.some((saved) => saved.id === book.id)
        ? current.filter((saved) => saved.id !== book.id)
        : [book, ...current],
    );
  }

  async function loadMoreBooks() {
    if (nextPage === null || isLoadingMore) return;

    const controller = new AbortController();
    let didTimeout = false;
    const timeoutId = window.setTimeout(() => {
      didTimeout = true;
      controller.abort();
    }, 20_000);
    loadMoreController.current?.abort();
    loadMoreController.current = controller;
    setIsLoadingMore(true);
    setLoadMoreError("");

    try {
      const result = await fetchBooks(
        { search: searchTerm, page: nextPage },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setCatalog((current) => {
        const existingIds = new Set(current.map((book) => book.id));
        return [
          ...current,
          ...result.books.filter((book) => !existingIds.has(book.id)),
        ];
      });
      setNextPage(result.nextPage);
    } catch (error) {
      if (controller.signal.aborted && !didTimeout) return;
      setLoadMoreError(
        didTimeout
          ? "More books are taking longer than usual to respond."
          : error instanceof Error
            ? error.message
            : "More books could not load.",
      );
    } finally {
      window.clearTimeout(timeoutId);
      if (!controller.signal.aborted || didTimeout) {
        setIsLoadingMore(false);
        loadMoreController.current = null;
      }
    }
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setView("discover");
    setActiveGenre("");
    setSearchTerm(searchInput.trim());
  }

  function changePage(nextPage: number) {
    setPageIndex(Math.max(0, Math.min(nextPage, pages.length - 1)));
  }

  async function installApp() {
    if (!installPrompt) return;

    try {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice.outcome === "accepted") setInstallPrompt(null);
    } catch (error) {
      console.error("Lorelight could not open the install prompt.", error);
    }
  }

  function handleReaderTouchEnd(event: TouchEvent<HTMLDivElement>) {
    const start = touchStartRef.current;
    const end = event.changedTouches[0];
    touchStartRef.current = null;
    if (!start || !end) return;

    const horizontalDistance = end.clientX - start.x;
    const verticalDistance = end.clientY - start.y;
    if (
      Math.abs(horizontalDistance) < 55 ||
      Math.abs(horizontalDistance) < Math.abs(verticalDistance) * 1.35
    ) {
      return;
    }

    changePage(pageIndex + (horizontalDistance < 0 ? 1 : -1));
  }

  useEffect(() => {
    if (!selectedBook) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeReader();
      if (event.key === "ArrowRight") changePage(pageIndex + 1);
      if (event.key === "ArrowLeft") changePage(pageIndex - 1);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [pageIndex, pages.length, selectedBook]);

  useEffect(() => {
    if (readerStageRef.current) readerStageRef.current.scrollTop = 0;
  }, [pageIndex, selectedBook]);

  const progress =
    pages.length > 0 ? ((pageIndex + 1) / pages.length) * 100 : 0;

  return (
    <main className="app-shell">
      <header className="topbar">
        <a
          className="brand"
          href="#top"
          onClick={() => {
            setView("discover");
            setSearchTerm("");
            setSearchInput("");
          }}
          aria-label="Lorelight home"
        >
          <span className="brand-mark">
            <Sparkles size={17} strokeWidth={1.8} />
          </span>
          <span>lorelight</span>
        </a>

        <nav className="main-nav" aria-label="Main navigation">
          <button
            className={view === "discover" ? "nav-link active" : "nav-link"}
            onClick={() => setView("discover")}
          >
            Discover
          </button>
          <button
            className={view === "shelf" ? "nav-link active" : "nav-link"}
            onClick={() => setView("shelf")}
          >
            My shelf
            {savedBooks.length > 0 && (
              <span className="shelf-count">{savedBooks.length}</span>
            )}
          </button>
          <a className="nav-link nav-about" href="#about">
            The idea
          </a>
        </nav>

        <button className="profile-button" onClick={() => setView("shelf")}>
          <span className="profile-orb">J</span>
          <span className="profile-label">Your reading nook</span>
        </button>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <div className="eyebrow">
            <span className="eyebrow-line" />
            A library for the curious
          </div>
          <h1>
            Find a little
            <br />
            <span>wonder</span> in every page.
          </h1>
          <p className="hero-description">
            Step into stories that stay with you. Discover timeless books,
            settle in, and let the rest of the world wait.
          </p>
          <div className="hero-actions">
            <button
              className="button button-primary"
              onClick={() => {
                setView("discover");
                document
                  .getElementById("library")
                  ?.scrollIntoView({ behavior: "smooth" });
              }}
            >
              Explore the library
              <ArrowRight size={16} />
            </button>
            <div className="hero-note">
              <span className="online-dot" />
              A growing collection of classics
            </div>
          </div>
        </div>

        <div className="hero-art" aria-label="Featured book">
          <div className="art-glow" />
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="hero-star star-one">✦</div>
          <div className="hero-star star-two">✧</div>
          <div className="floating-note note-top">
            <span className="note-icon"><Sparkles size={14} /></span>
            <span>Make room for wonder</span>
          </div>
          <div className="featured-book-wrap">
            <div className="featured-shadow" />
            <div className="featured-cover">
              <div className="cover-placeholder">
                <BookOpen size={42} strokeWidth={1} />
                <span>{featuredBook?.title ?? <>A story<br />awaits</>}</span>
              </div>
              {featuredBook?.formats["image/jpeg"] && (
                <img
                  src={getBookAssetUrl(featuredBook.formats["image/jpeg"])}
                  alt={`Cover of ${featuredBook.title}`}
                  onError={(event) => {
                    event.currentTarget.style.display = "none";
                  }}
                />
              )}
            </div>
            <div className="cover-shine" />
          </div>
          <div className="featured-caption">
            <span className="caption-kicker">A good place to begin</span>
            <span className="caption-title">
              {featuredBook?.title ?? "Your next favorite"}
            </span>
            <span className="caption-author">
              {featuredBook ? authorName(featuredBook) : "A timeless classic"}
            </span>
          </div>
          {featuredBook && (
            <button
              className="featured-open"
              onClick={() => openBook(featuredBook)}
              aria-label={`Read ${featuredBook.title}`}
            >
              <ArrowUpRight size={18} />
            </button>
          )}
        </div>
      </section>

      <section className="library-section" id="library">
        <div className="section-heading">
          <div>
            <div className="eyebrow section-eyebrow">
              <span className="eyebrow-line" />
              Your next chapter
            </div>
            <h2>{view === "shelf" ? "Your little library" : "Stories to get lost in"}</h2>
            <p className="section-subtitle">
              {view === "shelf"
                ? "The books you’ve tucked away for later."
                    : "Free-to-read classics, gathered from Project Gutenberg."}
            </p>
          </div>
          <form className="search-form" onSubmit={submitSearch} role="search">
            <Search size={17} />
            <input
              aria-label="Search books or authors"
              placeholder="A title, a feeling, an author..."
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
            />
            {searchInput && (
              <button
                type="button"
                className="clear-search"
                aria-label="Clear search"
                onClick={() => {
                  setSearchInput("");
                  setSearchTerm("");
                }}
              >
                <X size={15} />
              </button>
            )}
            <button className="search-submit" aria-label="Search">
              <ArrowRight size={16} />
            </button>
          </form>
        </div>

        {view === "discover" && (
          <div className="genre-row" aria-label="Browse by genre">
            {genres.map((genre) => (
              <button
                key={genre.topic || "all"}
                className={
                  activeGenre === genre.topic ? "genre-chip selected" : "genre-chip"
                }
                onClick={() => {
                  setActiveGenre(genre.topic);
                  setSearchInput("");
                  setSearchTerm("");
                }}
              >
                {genre.label}
              </button>
            ))}
            <span className="genre-divider" />
            <span className="genre-note">
              <Sparkles size={13} />
              No textbooks. Just good stories.
            </span>
          </div>
        )}

        <div className="catalog-meta">
          <span className="catalog-label">
            {view === "shelf"
              ? "SAVED FOR A QUIETER MOMENT"
              : searchTerm
                ? `SEARCH RESULTS FOR “${searchTerm}”`
                : activeGenre
                  ? genres.find((genre) => genre.topic === activeGenre)?.label.toUpperCase()
                  : "THE LORELIGHT COLLECTION"}
          </span>
          {!isLoading && !loadError && (
            <span className="result-count">
              {visibleBooks.length} {visibleBooks.length === 1 ? "book" : "books"}
            </span>
          )}
        </div>

        {view === "discover" && loadError && (
          <div className="state-card error-card" role="alert">
            <div className="state-icon"><BookOpen size={20} /></div>
            <div>
              <h3>The shelves are taking a moment.</h3>
              <p>{loadError} Please try again in a little while.</p>
            </div>
            <button
              className="button button-subtle"
              onClick={() => setRetry((value) => value + 1)}
            >
              Try again <ArrowRight size={15} />
            </button>
          </div>
        )}

        {isLoading && view === "discover" && (
          <div className="loading-state" aria-live="polite">
            <LoaderCircle className="spinner" size={24} />
            <span>Turning the shelves...</span>
          </div>
        )}

        {!isLoading && !loadError && visibleBooks.length > 0 && (
          <div className="book-grid">
            {visibleBooks.map((book, index) => {
              const isSaved = savedBooks.some((saved) => saved.id === book.id);
              return (
                <article
                  className="book-card"
                  key={book.id}
                  style={{ animationDelay: `${Math.min(index, 9) * 45}ms` }}
                >
                  <div className={`book-cover cover-tone-${index % 6}`}>
                    <div className="cover-placeholder cover-fallback">
                      <BookOpen size={31} strokeWidth={1} />
                      <span>{book.title}</span>
                    </div>
                    {book.formats["image/jpeg"] ? (
                      <img
                        src={getBookAssetUrl(book.formats["image/jpeg"])}
                        alt={`Cover of ${book.title}`}
                        loading="lazy"
                        onError={(event) => {
                          event.currentTarget.style.display = "none";
                        }}
                      />
                    ) : null}
                    <div className="cover-overlay" />
                    <button
                      className={isSaved ? "save-book saved" : "save-book"}
                      aria-label={isSaved ? `Remove ${book.title} from shelf` : `Save ${book.title}`}
                      onClick={() => toggleSaved(book)}
                    >
                      {isSaved ? <Check size={16} /> : <Plus size={17} />}
                    </button>
                    <button
                      className="cover-open"
                      onClick={() => openBook(book)}
                      aria-label={`Read ${book.title}`}
                    >
                      <BookOpen size={15} />
                      Open book
                    </button>
                  </div>
                  <div className="book-info">
                    <span className="book-category">{categoryName(book)}</span>
                    <button className="book-title" onClick={() => openBook(book)}>
                      {book.title}
                    </button>
                    <span className="book-author">{authorName(book)}</span>
                    <div className="book-footer">
                      <span>
                        <Heart size={12} />
                        {formatDownloads(book.download_count)} readers
                      </span>
                      <button
                        className={isSaved ? "tiny-bookmark saved" : "tiny-bookmark"}
                        aria-label={isSaved ? `Unsave ${book.title}` : `Save ${book.title}`}
                        onClick={() => toggleSaved(book)}
                      >
                        <Bookmark size={15} fill={isSaved ? "currentColor" : "none"} />
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {view === "discover" && !isLoading && nextPage !== null && (
          <div className="load-more-wrap">
            {loadMoreError && (
              <p className="load-more-error" role="alert">
                {loadMoreError}
              </p>
            )}
            <button
              className="button button-subtle load-more-button"
              onClick={() => void loadMoreBooks()}
              disabled={isLoadingMore}
            >
              {isLoadingMore ? (
                <LoaderCircle className="spinner" size={15} />
              ) : (
                <ArrowRight size={15} />
              )}
              {loadMoreError
                ? "Try again"
                : isLoadingMore
                  ? "Finding more stories..."
                  : "Keep wandering"}
            </button>
          </div>
        )}

        {!isLoading && !loadError && visibleBooks.length === 0 && (
          <div className="empty-state">
            <div className="empty-art"><LibraryBig size={27} /></div>
            <span className="eyebrow">A shelf with room to grow</span>
            <h3>{view === "shelf" ? "Nothing saved just yet." : "No stories found this time."}</h3>
            <p>
              {view === "shelf"
                ? "When a book catches your eye, tuck it here for later."
                : "Try another title or wander into a different genre."}
            </p>
            {view === "shelf" && (
              <button className="button button-primary" onClick={() => setView("discover")}>
                Find a book <ArrowRight size={15} />
              </button>
            )}
          </div>
        )}
      </section>

      <footer className="site-footer" id="about">
        <a className="brand footer-brand" href="#top">
          <span className="brand-mark"><Sparkles size={15} /></span>
          <span>lorelight</span>
        </a>
        <p>A small, quiet corner of the internet for big stories.</p>
        <span className="footer-source">
          Book data by <a href="https://gutendex.com/" target="_blank" rel="noreferrer">Gutendex</a>
          <span className="footer-dot">·</span>
          Texts from <a href="https://www.gutenberg.org/" target="_blank" rel="noreferrer">Project Gutenberg</a>
        </span>
        <span className="rights-note">
          Catalog availability and public-domain status can vary by country.
        </span>
      </footer>

      <nav className="mobile-nav" aria-label="Mobile navigation">
        <button
          className={view === "discover" ? "mobile-nav-item active" : "mobile-nav-item"}
          onClick={() => setView("discover")}
        >
          <Sparkles size={18} />
          <span>Discover</span>
        </button>
        <button
          className={view === "shelf" ? "mobile-nav-item active" : "mobile-nav-item"}
          onClick={() => setView("shelf")}
        >
          <Bookmark size={18} />
          <span>My shelf</span>
        </button>
        {installPrompt && (
          <button className="mobile-nav-item install-nav-item" onClick={() => void installApp()}>
            <Download size={18} />
            <span>Install app</span>
          </button>
        )}
      </nav>

      {selectedBook && (
        <section
          className={`reader-overlay theme-${readerTheme}`}
          role="dialog"
          aria-modal="true"
          aria-label={`Reading ${selectedBook.title}`}
        >
          <header className="reader-topbar">
            <button className="reader-brand" onClick={closeReader}>
              <span className="reader-brand-icon"><Sparkles size={15} /></span>
              <span>lorelight</span>
            </button>
            <div className="reader-book-heading">
              <span>{selectedBook.title}</span>
              <small>{authorName(selectedBook)}</small>
            </div>
            <div className="reader-tools">
              <div className="theme-picker" aria-label="Reading theme">
                <button
                  className={readerTheme === "paper" ? "theme-choice active" : "theme-choice"}
                  onClick={() => setReaderTheme("paper")}
                  aria-label="Paper theme"
                  title="Paper theme"
                >
                  <Sun size={15} />
                </button>
                <button
                  className={readerTheme === "sepia" ? "theme-choice active" : "theme-choice"}
                  onClick={() => setReaderTheme("sepia")}
                  aria-label="Sepia theme"
                  title="Sepia theme"
                >
                  <Coffee size={15} />
                </button>
                <button
                  className={readerTheme === "night" ? "theme-choice active" : "theme-choice"}
                  onClick={() => setReaderTheme("night")}
                  aria-label="Night theme"
                  title="Night theme"
                >
                  <Moon size={15} />
                </button>
              </div>
              <div className="font-picker" aria-label="Text size">
                <button
                  aria-label="Decrease text size"
                  disabled={fontSize <= 15}
                  onClick={() => setFontSize((size) => Math.max(15, size - 1))}
                >
                  <span>A</span><span className="font-minus">−</span>
                </button>
                <button
                  aria-label="Increase text size"
                  disabled={fontSize >= 23}
                  onClick={() => setFontSize((size) => Math.min(23, size + 1))}
                >
                  <span>A</span><Plus size={10} />
                </button>
              </div>
              <button className="reader-close" onClick={closeReader} aria-label="Close reader">
                <X size={19} />
              </button>
            </div>
          </header>

          <div className="reader-progress">
            <div style={{ width: `${progress}%` }} />
          </div>

          <div
            className="reader-stage"
            ref={readerStageRef}
            onTouchStart={(event) => {
              const touch = event.touches[0];
              if (touch) {
                touchStartRef.current = { x: touch.clientX, y: touch.clientY };
              }
            }}
            onTouchEnd={handleReaderTouchEnd}
          >
            <div className="reader-side-note">
              <span className="side-note-mark">✦</span>
              <span>Take your time.</span>
              <span className="side-note-line" />
              <span>There’s nowhere else to be.</span>
            </div>

            {isReaderLoading && (
              <div className="reader-state" aria-live="polite">
                <LoaderCircle className="spinner" size={24} />
                <span>Finding your place in the story...</span>
              </div>
            )}

            {readerError && (
              <div className="reader-state reader-error" role="alert">
                <div className="reader-error-icon"><BookOpen size={24} /></div>
                <span className="reader-error-title">The page is out of reach.</span>
                <p>{readerError}</p>
                <div className="reader-error-actions">
                  <button
                    className="button button-primary"
                    onClick={() => setReaderRetry((value) => value + 1)}
                  >
                    Try again <ArrowRight size={15} />
                  </button>
                  <a
                    className="button button-subtle"
                    href={getBookSourceUrl(selectedBook)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Source edition <ArrowUpRight size={15} />
                  </a>
                </div>
              </div>
            )}

            {!isReaderLoading && !readerError && pages.length > 0 && (
              <article
                className="reader-page"
                key={`${selectedBook.id}-${pageIndex}`}
                style={{ fontSize: `${fontSize}px` }}
              >
                <div className="page-kicker">
                  <span className="page-sparkle">✧</span>
                  A moment with a book
                </div>
                {pageIndex === 0 && (
                  <div className="page-title-block">
                    <span className="page-author">{authorName(selectedBook)}</span>
                    <h1>{selectedBook.title}</h1>
                    <span className="page-title-rule" />
                  </div>
                )}
                <div className="page-copy">
                  {pages[pageIndex]?.map((paragraph, index) => (
                    <p key={`${pageIndex}-${index}`}>{paragraph}</p>
                  ))}
                </div>
                <div className="page-number">{String(pageIndex + 1).padStart(2, "0")}</div>
              </article>
            )}
          </div>

          <footer className="reader-footer">
            <div className="reader-footer-note">
              <span
                className={
                  offlineStatus === "saved"
                    ? "reading-indicator offline-ready"
                    : "reading-indicator"
                }
              />
              <span>
                {offlineStatus === "saved"
                  ? "Ready offline"
                  : offlineStatus === "saving"
                    ? "Saving for offline reading"
                    : offlineStatus === "unavailable"
                      ? "Offline save unavailable"
                      : "Getting your book ready"}
              </span>
            </div>
            <div className="page-controls">
              <button
                className="page-control"
                onClick={() => changePage(pageIndex - 1)}
                disabled={pageIndex <= 0 || pages.length === 0}
                aria-label="Previous page"
              >
                <ChevronLeft size={17} />
                <span>Back</span>
              </button>
              <span className="page-count">
                <strong>{pages.length ? pageIndex + 1 : "—"}</strong>
                <span> / {pages.length || "—"}</span>
              </span>
              <button
                className="page-control next-page"
                onClick={() => changePage(pageIndex + 1)}
                disabled={pageIndex >= pages.length - 1 || pages.length === 0}
                aria-label="Next page"
              >
                <span>Turn the page</span>
                <ChevronRight size={17} />
              </button>
            </div>
            <a
              className="source-link"
              href={getBookSourceUrl(selectedBook)}
              target="_blank"
              rel="noreferrer"
            >
              Original edition <ArrowUpRight size={13} />
            </a>
          </footer>
        </section>
      )}
    </main>
  );
}

export default App;
