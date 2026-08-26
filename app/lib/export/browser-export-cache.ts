import type { RepoDNAProjectV2 } from '../analyzer/v2/types';

export const BROWSER_EXPORT_CACHE_DB = 'repodna-export-cache';
export const BROWSER_EXPORT_CACHE_VERSION = 1;
export const BROWSER_EXPORT_CACHE_CONSENT_KEY = 'repodna_export_cache_consent';
export const BROWSER_EXPORT_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ARTIFACTS = 10;
const MAX_BYTES_FALLBACK = 200 * 1024 * 1024;

export type BrowserCacheConsent = 'granted' | 'denied';

export type BrowserCacheSourceType =
  | 'public-durable'
  | 'public-browser'
  | 'github-private'
  | 'local-folder'
  | 'zip-upload'
  | 'imported-json'
  | 'sample';

export interface BrowserCachedArtifact {
  key: string;
  sourceType: BrowserCacheSourceType;
  sourceDigest: string;
  project: RepoDNAProjectV2;
  byteSize: number;
  createdAt: number;
  expiresAt: number;
  lastAccessedAt: number;
}

export interface BrowserCachedExport {
  id: string;
  artifactKey: string;
  format: string;
  filename: string;
  mediaType: string;
  sha256: string;
  blob: Blob;
  byteSize: number;
  createdAt: number;
  expiresAt: number;
  lastAccessedAt: number;
}

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof indexedDB !== 'undefined';
}

export function getBrowserCacheConsent(): BrowserCacheConsent | null {
  if (!isBrowser()) return null;
  const value = localStorage.getItem(BROWSER_EXPORT_CACHE_CONSENT_KEY);
  return value === 'granted' || value === 'denied' ? value : null;
}

export function setBrowserCacheConsent(consent: BrowserCacheConsent): void {
  if (!isBrowser()) return;
  localStorage.setItem(BROWSER_EXPORT_CACHE_CONSENT_KEY, consent);
}

export function isBrowserCacheConsentGranted(): boolean {
  return getBrowserCacheConsent() === 'granted';
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(BROWSER_EXPORT_CACHE_DB, BROWSER_EXPORT_CACHE_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('artifacts')) {
        const store = db.createObjectStore('artifacts', { keyPath: 'key' });
        store.createIndex('expiresAt', 'expiresAt', { unique: false });
        store.createIndex('lastAccessedAt', 'lastAccessedAt', { unique: false });
        store.createIndex('sourceType', 'sourceType', { unique: false });
      }
      if (!db.objectStoreNames.contains('exports')) {
        const store = db.createObjectStore('exports', { keyPath: 'id' });
        store.createIndex('artifactKey', 'artifactKey', { unique: false });
        store.createIndex('expiresAt', 'expiresAt', { unique: false });
        store.createIndex('lastAccessedAt', 'lastAccessedAt', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(
  storeName: 'artifacts' | 'exports',
  mode: IDBTransactionMode,
  callback: (store: IDBObjectStore) => Promise<T> | T
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    let result: T;
    let callbackError: unknown = null;
    Promise.resolve()
      .then(() => callback(store))
      .then((value) => {
        result = value;
      })
      .catch((error) => {
        callbackError = error;
        try {
          tx.abort();
        } catch {}
      });
    tx.oncomplete = () => {
      db.close();
      if (callbackError) reject(callbackError);
      else resolve(result!);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
    tx.onabort = () => {
      db.close();
      if (callbackError) reject(callbackError);
      else reject(tx.error);
    };
  });
}

function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function hashCacheKey(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function saveBrowserArtifact(entry: BrowserCachedArtifact): Promise<void> {
  if (!isBrowser()) return;
  await evictExpiredBrowserEntries();
  await enforceBrowserLimits(entry.byteSize);
  await withStore('artifacts', 'readwrite', async (store) => {
    const existing = await idbRequest(store.get(entry.key) as IDBRequest<BrowserCachedArtifact | undefined>);
    if (existing && existing.expiresAt > Date.now()) {
      entry.createdAt = existing.createdAt;
      entry.expiresAt = existing.expiresAt;
    }
    await idbRequest(store.put(entry));
  });
}

export async function getBrowserArtifact(key: string): Promise<BrowserCachedArtifact | null> {
  if (!isBrowser()) return null;
  const entry = await withStore('artifacts', 'readonly', async (store) => {
    return (await idbRequest(store.get(key) as IDBRequest<BrowserCachedArtifact | undefined>)) ?? null;
  });
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    await deleteBrowserArtifact(key);
    return null;
  }
  entry.lastAccessedAt = Date.now();
  await withStore('artifacts', 'readwrite', async (store) => {
    await idbRequest(store.put(entry));
  }).catch(() => undefined);
  return entry;
}

export async function deleteBrowserArtifact(key: string): Promise<void> {
  if (!isBrowser()) return;
  await withStore('artifacts', 'readwrite', async (store) => {
    await idbRequest(store.delete(key));
  });
  await withStore('exports', 'readwrite', async (store) => {
    const index = store.index('artifactKey');
    const range = IDBKeyRange.only(key);
    const cursorRequest = index.openCursor(range);
    await new Promise<void>((resolve, reject) => {
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor) {
          resolve();
          return;
        }
        cursor.delete();
        cursor.continue();
      };
      cursorRequest.onerror = () => reject(cursorRequest.error);
    });
  });
}

export async function saveBrowserExport(entry: BrowserCachedExport): Promise<void> {
  if (!isBrowser()) return;
  await evictExpiredBrowserEntries();
  await enforceBrowserLimits(entry.byteSize);
  await withStore('exports', 'readwrite', async (store) => {
    await idbRequest(store.put(entry));
  });
}

export async function getBrowserExport(id: string): Promise<BrowserCachedExport | null> {
  if (!isBrowser()) return null;
  const entry = await withStore('exports', 'readonly', async (store) => {
    return (await idbRequest(store.get(id) as IDBRequest<BrowserCachedExport | undefined>)) ?? null;
  });
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    await withStore('exports', 'readwrite', async (store) => {
      await idbRequest(store.delete(id));
    });
    return null;
  }
  entry.lastAccessedAt = Date.now();
  await withStore('exports', 'readwrite', async (store) => {
    await idbRequest(store.put(entry));
  }).catch(() => undefined);
  return entry;
}

export async function listBrowserArtifacts(): Promise<BrowserCachedArtifact[]> {
  if (!isBrowser()) return [];
  const entries = await withStore('artifacts', 'readonly', async (store) => {
    return (await idbRequest(store.getAll() as IDBRequest<BrowserCachedArtifact[]>)) ?? [];
  });
  return entries
    .filter((entry) => entry.expiresAt > Date.now())
    .sort((a, b) => b.lastAccessedAt - a.lastAccessedAt);
}

export async function clearBrowserArtifactsBySourceType(sourceType: BrowserCacheSourceType): Promise<void> {
  if (!isBrowser()) return;
  await withStore('artifacts', 'readwrite', async (store) => {
    const index = store.index('sourceType');
    const range = IDBKeyRange.only(sourceType);
    const cursorRequest = index.openCursor(range);
    await new Promise<void>((resolve, reject) => {
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor) {
          resolve();
          return;
        }
        cursor.delete();
        cursor.continue();
      };
      cursorRequest.onerror = () => reject(cursorRequest.error);
    });
  });
  await withStore('exports', 'readwrite', async (store) => {
    const all = (await idbRequest(store.getAll() as IDBRequest<BrowserCachedExport[]>)) ?? [];
    for (const entry of all) {
      if (entry.id.startsWith(`${sourceType}:`) || entry.artifactKey.includes(sourceType)) {
        await idbRequest(store.delete(entry.id));
      }
    }
  });
}

export async function clearAllBrowserCaches(): Promise<void> {
  if (!isBrowser()) return;
  await withStore('artifacts', 'readwrite', async (store) => {
    await idbRequest(store.clear());
  });
  await withStore('exports', 'readwrite', async (store) => {
    await idbRequest(store.clear());
  });
}

async function evictExpiredBrowserEntries(): Promise<void> {
  if (!isBrowser()) return;
  const now = Date.now();
  await withStore('artifacts', 'readwrite', async (store) => {
    const index = store.index('expiresAt');
    const range = IDBKeyRange.upperBound(now);
    const cursorRequest = index.openCursor(range);
    await new Promise<void>((resolve, reject) => {
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor) {
          resolve();
          return;
        }
        cursor.delete();
        cursor.continue();
      };
      cursorRequest.onerror = () => reject(cursorRequest.error);
    });
  });
  await withStore('exports', 'readwrite', async (store) => {
    const index = store.index('expiresAt');
    const range = IDBKeyRange.upperBound(now);
    const cursorRequest = index.openCursor(range);
    await new Promise<void>((resolve, reject) => {
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor) {
          resolve();
          return;
        }
        cursor.delete();
        cursor.continue();
      };
      cursorRequest.onerror = () => reject(cursorRequest.error);
    });
  });
}

async function enforceBrowserLimits(incomingBytes: number): Promise<void> {
  if (!isBrowser()) return;
  let quotaBytes = MAX_BYTES_FALLBACK;
  try {
    const estimate = await navigator.storage.estimate();
    if (typeof estimate.quota === 'number' && estimate.quota > 0) {
      quotaBytes = Math.min(MAX_BYTES_FALLBACK, Math.floor(estimate.quota * 0.2));
    }
  } catch {}
  const artifacts = await withStore('artifacts', 'readonly', async (store) => {
    return (await idbRequest(store.getAll() as IDBRequest<BrowserCachedArtifact[]>)) ?? [];
  });
  const exportsList = await withStore('exports', 'readonly', async (store) => {
    return (await idbRequest(store.getAll() as IDBRequest<BrowserCachedExport[]>)) ?? [];
  });
  let totalBytes = incomingBytes;
  for (const entry of artifacts) totalBytes += entry.byteSize;
  for (const entry of exportsList) totalBytes += entry.byteSize;

  if (artifacts.length >= MAX_ARTIFACTS || totalBytes > quotaBytes) {
    const sorted = [...artifacts].sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);
    for (const entry of sorted) {
      if (artifacts.length < MAX_ARTIFACTS && totalBytes <= quotaBytes) break;
      await deleteBrowserArtifact(entry.key);
      totalBytes -= entry.byteSize;
    }
  }
  if (totalBytes > quotaBytes) {
    const sortedExports = [...exportsList].sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);
    for (const entry of sortedExports) {
      if (totalBytes <= quotaBytes) break;
      await withStore('exports', 'readwrite', async (store) => {
        await idbRequest(store.delete(entry.id));
      });
      totalBytes -= entry.byteSize;
    }
  }
}
