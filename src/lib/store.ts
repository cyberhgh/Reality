import { promises as fs } from "fs";
import path from "path";
import { put, list, del } from "@vercel/blob";
import type { BanZone, Placement, StoreData } from "./types";

const EMPTY: StoreData = { placements: [], zones: [] };
const LOCAL_PATH = path.join(process.cwd(), "data", "store.json");
const PLACEMENT_PREFIX = "placements/";
const ZONE_PREFIX = "zones/";

declare global {
  // eslint-disable-next-line no-var
  var __realityStore: StoreData | undefined;
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

function blobToken() {
  return process.env.BLOB_READ_WRITE_TOKEN;
}

function blobEnabled() {
  return Boolean(blobToken()) || Boolean(process.env.VERCEL);
}

function blobOpts() {
  const token = blobToken();
  return token ? { token } : {};
}

async function fetchJson<T>(url: string): Promise<T | null> {
  const bust = url.includes("?") ? `&v=${Date.now()}` : `?v=${Date.now()}`;
  const res = await fetch(`${url}${bust}`, {
    cache: "no-store",
    headers: { "Cache-Control": "no-cache" },
  });
  if (!res.ok) return null;
  return (await res.json()) as T;
}

async function listJsonPrefix<T>(prefix: string): Promise<T[]> {
  const opts = blobOpts();
  const { blobs } = await list({ prefix, limit: 1000, ...opts });
  const items: T[] = [];
  for (const blob of blobs) {
    const item = await fetchJson<T>(blob.url);
    if (item) items.push(item);
  }
  return items;
}

async function readFromBlob(): Promise<StoreData | null> {
  if (!blobEnabled()) return null;
  try {
    const [placements, zones] = await Promise.all([
      listJsonPrefix<Placement>(PLACEMENT_PREFIX),
      listJsonPrefix<BanZone>(ZONE_PREFIX),
    ]);
    return { placements, zones };
  } catch (err) {
    console.error("Blob read failed:", err);
    return null;
  }
}

async function putPlacementBlob(placement: Placement) {
  await put(`${PLACEMENT_PREFIX}${placement.id}.json`, JSON.stringify(placement), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
    ...blobOpts(),
  });
}

async function putZoneBlob(zone: BanZone) {
  await put(`${ZONE_PREFIX}${zone.id}.json`, JSON.stringify(zone), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
    ...blobOpts(),
  });
}

async function deleteBlobByPrefix(prefix: string, id: string) {
  const opts = blobOpts();
  const pathname = `${prefix}${id}.json`;
  const { blobs } = await list({ prefix: pathname, limit: 5, ...opts });
  await Promise.all(blobs.map((b) => del(b.url, opts)));
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
}

export async function addPlacement(placement: Placement): Promise<void> {
  if (blobEnabled()) {
    try {
      await putPlacementBlob(placement);
      const mem = memoryGet();
      mem.placements = [placement, ...mem.placements.filter((p) => p.id !== placement.id)];
      return;
    } catch (err) {
      console.error("Blob placement write failed:", err);
      if (process.env.VERCEL) throw err;
    }
  }

  const current = (await readFromFile()) ?? structuredClone(memoryGet());
  current.placements = [placement, ...current.placements.filter((p) => p.id !== placement.id)].slice(0, 500);
  memorySet(current);
  const ok = await writeToFile(current);
  if (!ok && process.env.VERCEL) {
    throw new Error("Could not persist placement.");
  }
}

export async function removePlacement(id: string): Promise<void> {
  if (blobEnabled()) {
    try {
      await deleteBlobByPrefix(PLACEMENT_PREFIX, id);
      const mem = memoryGet();
      mem.placements = mem.placements.filter((p) => p.id !== id);
      return;
    } catch (err) {
      console.error("Blob placement delete failed:", err);
      if (process.env.VERCEL) throw err;
    }
  }

  const current = (await readFromFile()) ?? structuredClone(memoryGet());
  current.placements = current.placements.filter((p) => p.id !== id);
  memorySet(current);
  await writeToFile(current);
}

export async function addZone(zone: BanZone): Promise<void> {
  if (blobEnabled()) {
    try {
      await putZoneBlob(zone);
      const mem = memoryGet();
      mem.zones = [zone, ...mem.zones.filter((z) => z.id !== zone.id)];
      return;
    } catch (err) {
      console.error("Blob zone write failed:", err);
      if (process.env.VERCEL) throw err;
    }
  }

  const current = (await readFromFile()) ?? structuredClone(memoryGet());
  current.zones = [zone, ...current.zones.filter((z) => z.id !== zone.id)].slice(0, 200);
  memorySet(current);
  const ok = await writeToFile(current);
  if (!ok && process.env.VERCEL) {
    throw new Error("Could not persist zone.");
  }
}

export async function removeZone(id: string): Promise<void> {
  if (blobEnabled()) {
    try {
      await deleteBlobByPrefix(ZONE_PREFIX, id);
      const mem = memoryGet();
      mem.zones = mem.zones.filter((z) => z.id !== id);
      return;
    } catch (err) {
      console.error("Blob zone delete failed:", err);
      if (process.env.VERCEL) throw err;
    }
  }

  const current = (await readFromFile()) ?? structuredClone(memoryGet());
  current.zones = current.zones.filter((z) => z.id !== id);
  memorySet(current);
  await writeToFile(current);
}

export function persistenceMode(): "blob" | "file" | "memory" {
  if (blobToken() || process.env.VERCEL) return "blob";
  return "file";
}
