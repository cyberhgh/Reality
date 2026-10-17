import { promises as fs } from "fs";
import path from "path";
import { put, list, head } from "@vercel/blob";
import type { StoreData } from "./types";

const EMPTY: StoreData = { placements: [], zones: [] };
const BLOB_PATHNAME = "reality-store.json";
const LOCAL_PATH = path.join(process.cwd(), "data", "store.json");

declare global {
  // eslint-disable-next-line no-var
  var __realityStore: StoreData | undefined;
  // eslint-disable-next-line no-var
  var __realityStoreLock: Promise<void> | undefined;
}

function memoryGet(): StoreData {
  if (!globalThis.__realityStore) {
    globalThis.__realityStore = structuredClone(EMPTY);
  }
  return globalThis.__realityStore;
}

function memorySet(data: StoreData) {
  globalThis.__realityStore = data;
}

async function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = globalThis.__realityStoreLock ?? Promise.resolve();
  let release!: () => void;
  globalThis.__realityStoreLock = new Promise<void>((r) => {
    release = r;
  });
  await prev;
  try {
    return await fn();
  } finally {
    release();
  }
}

function blobToken() {
  return process.env.BLOB_READ_WRITE_TOKEN;
}

function blobEnabled() {
  return Boolean(blobToken()) || Boolean(process.env.VERCEL);
}

function blobOpts() {
  const token = blobToken();
  return token ? { token } : undefined;
}

async function fetchJson(url: string): Promise<StoreData | null> {
  // Bust Next.js / CDN caches — stale reads were wiping newly placed items.
  const bust = url.includes("?") ? `&v=${Date.now()}` : `?v=${Date.now()}`;
  const res = await fetch(`${url}${bust}`, {
    cache: "no-store",
    headers: { "Cache-Control": "no-cache" },
  });
  if (!res.ok) return null;
  return (await res.json()) as StoreData;
}

async function readFromBlob(): Promise<StoreData | null> {
  if (!blobEnabled()) return null;
  const opts = blobOpts();
  try {
    try {
      const meta = await head(BLOB_PATHNAME, opts);
      return await fetchJson(meta.url);
    } catch {
      const { blobs } = await list({ prefix: BLOB_PATHNAME, limit: 5, ...opts });
      const blob =
        blobs.find((b) => b.pathname === BLOB_PATHNAME) ?? blobs[0] ?? null;
      if (!blob) return null;
      return await fetchJson(blob.url);
    }
  } catch (err) {
    console.error("Blob read failed:", err);
    return null;
  }
}

async function writeToBlob(data: StoreData) {
  if (!blobEnabled()) return false;
  try {
    await put(BLOB_PATHNAME, JSON.stringify(data), {
      access: "public",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: true,
      ...blobOpts(),
    });
    return true;
  } catch (err) {
    console.error("Blob write failed:", err);
    return false;
  }
}

async function readFromFile(): Promise<StoreData | null> {
  try {
    const raw = await fs.readFile(LOCAL_PATH, "utf8");
    return JSON.parse(raw) as StoreData;
  } catch {
    return null;
  }
}

async function writeToFile(data: StoreData) {
  try {
    await fs.mkdir(path.dirname(LOCAL_PATH), { recursive: true });
    await fs.writeFile(LOCAL_PATH, JSON.stringify(data, null, 2), "utf8");
    return true;
  } catch {
    return false;
  }
}

export async function getStore(): Promise<StoreData> {
  return withLock(async () => {
    const fromBlob = await readFromBlob();
    if (fromBlob) {
      memorySet(fromBlob);
      return structuredClone(fromBlob);
    }
    const fromFile = await readFromFile();
    if (fromFile) {
      memorySet(fromFile);
      return structuredClone(fromFile);
    }
    return structuredClone(memoryGet());
  });
}

export async function updateStore(
  mutator: (current: StoreData) => StoreData | Promise<StoreData>,
): Promise<{ data: StoreData; durable: boolean }> {
  return withLock(async () => {
    const current =
      (await readFromBlob()) ??
      (await readFromFile()) ??
      structuredClone(memoryGet());

    const next = await mutator(structuredClone(current));
    memorySet(next);

    const wroteBlob = await writeToBlob(next);
    if (wroteBlob) {
      return { data: structuredClone(next), durable: true };
    }

    const wroteFile = await writeToFile(next);
    if (wroteFile) {
      return { data: structuredClone(next), durable: true };
    }

    if (process.env.VERCEL) {
      throw new Error(
        "Could not persist data. Blob storage is unavailable on this deployment.",
      );
    }

    return { data: structuredClone(next), durable: false };
  });
}

export function persistenceMode(): "blob" | "file" | "memory" {
  if (blobToken() || process.env.VERCEL) return "blob";
  return "file";
}
