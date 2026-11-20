interface StoredBook {
  id: number;
  text: string;
  savedAt: number;
}

interface ReadingProgress {
  id: number;
  pageIndex: number;
  updatedAt: number;
}

const databaseName = "lorelight-library";
let databasePromise: Promise<IDBDatabase> | undefined;

function openDatabase(): Promise<IDBDatabase> {
  if (!("indexedDB" in window)) {
    return Promise.reject(new Error("Offline book storage is not available."));
  }

  if (!databasePromise) {
    databasePromise = new Promise((resolve, reject) => {
      const request = window.indexedDB.open(databaseName, 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains("books")) {
          database.createObjectStore("books", { keyPath: "id" });
        }
        if (!database.objectStoreNames.contains("progress")) {
          database.createObjectStore("progress", { keyPath: "id" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        databasePromise = undefined;
        reject(request.error ?? new Error("Offline book storage could not open."));
      };
      request.onblocked = () => {
        databasePromise = undefined;
        reject(new Error("Offline book storage is blocked by another tab."));
      };
    });
  }

  return databasePromise;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Offline book storage failed."));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("Offline book storage was interrupted."));
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("Offline book storage failed."));
  });
}

export async function getSavedBookText(id: number): Promise<string | undefined> {
  const database = await openDatabase();
  const transaction = database.transaction("books", "readonly");
  const record = await requestResult<StoredBook | undefined>(
    transaction.objectStore("books").get(id),
  );
  if (record && typeof record.text !== "string") {
    throw new Error("The saved book text is not readable.");
  }
  return record?.text;
}

export async function saveBookText(id: number, text: string): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction("books", "readwrite");
  const completed = transactionComplete(transaction);
  const request = requestResult(
    transaction.objectStore("books").put({ id, text, savedAt: Date.now() }),
  );
  await Promise.all([completed, request]);
}

export async function getReadingProgress(id: number): Promise<number> {
  const database = await openDatabase();
  const transaction = database.transaction("progress", "readonly");
  const record = await requestResult<ReadingProgress | undefined>(
    transaction.objectStore("progress").get(id),
  );
  return record?.pageIndex ?? 0;
}

export async function saveReadingProgress(
  id: number,
  pageIndex: number,
): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction("progress", "readwrite");
  const completed = transactionComplete(transaction);
  const request = requestResult(
    transaction
      .objectStore("progress")
      .put({ id, pageIndex, updatedAt: Date.now() }),
  );
  await Promise.all([completed, request]);
}
