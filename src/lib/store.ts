import { promises as fs } from "fs";
import path from "path";
import { put, list, del } from "@vercel/blob";
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

function hasBlobToken() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

async function readFromBlob(): Promise<StoreData | null> {
  if (!hasBlobToken()) return null;
  try {
    const { blobs } = await list({ prefix: BLOB_PATHNAME, limit: 1 });
    const blob = blobs.find((b) => b.pathname === BLOB_PATHNAME) ?? blobs[0];
    if (!blob) return null;
    const res = await fetch(blob.url, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as StoreData;
  } catch {
    return null;
  }
}

async function writeToBlob(data: StoreData) {
  if (!hasBlobToken()) return false;
  try {
    const { blobs } = await list({ prefix: BLOB_PATHNAME, limit: 5 });
    await Promise.all(
      blobs.map((b) => del(b.url).catch(() => undefined)),
    );
    await put(BLOB_PATHNAME, JSON.stringify(data, null, 2), {
      access: "public",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    return true;
  } catch {
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
): Promise<StoreData> {
  return withLock(async () => {
    let current =
      (await readFromBlob()) ??
      (await readFromFile()) ??
      structuredClone(memoryGet());

    const next = await mutator(structuredClone(current));
    memorySet(next);

    const wroteBlob = await writeToBlob(next);
    if (!wroteBlob) {
      await writeToFile(next);
    }
    return structuredClone(next);
  });
}

export function persistenceMode(): "blob" | "file" | "memory" {
  if (hasBlobToken()) return "blob";
  if (process.env.VERCEL) return "memory";
  return "file";
}
