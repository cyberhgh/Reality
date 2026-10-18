import { promises as fs } from "fs";
import path from "path";
import { put, list, del } from "@vercel/blob";
import type {
  BanZone,
  FindEvent,
  Placement,
  Reaction,
  StoreData,
} from "./types";
import type { LandPermit } from "./publicPlace";

const EMPTY: StoreData = { placements: [], zones: [] };
const LOCAL_PATH = path.join(process.cwd(), "data", "store.json");
const PLACEMENT_PREFIX = "placements/";
const ZONE_PREFIX = "zones/";
const FIND_PREFIX = "finds/";
const REACTION_PREFIX = "reactions/";
const PERMIT_PREFIX = "permits/";

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

export function normalizePlacement(raw: Partial<Placement> & { id: string }): Placement {
  return {
    id: raw.id,
    emoji: raw.emoji ?? "🗿",
    label: raw.label ?? "Untitled",
    note: raw.note ?? "",
    lat: Number(raw.lat),
    lng: Number(raw.lng),
    altitude: raw.altitude ?? null,
    createdAt: raw.createdAt ?? new Date().toISOString(),
    createdBy: raw.createdBy ?? "anonymous",
    createdByName: raw.createdByName ?? "Explorer",
    byAdmin: Boolean(raw.byAdmin),
    snapCode: raw.snapCode ?? raw.id.slice(0, 6).toUpperCase(),
    findCount: Number(raw.findCount ?? 0),
    reactionCount: Number(raw.reactionCount ?? 0),
    landmarkUrl: raw.landmarkUrl ?? null,
    placeSource: raw.placeSource,
    visibility: raw.visibility ?? "public",
    landPermitId: raw.landPermitId ?? null,
    landOwnerId: raw.landOwnerId ?? null,
    landOwnerName: raw.landOwnerName ?? null,
  };
}

/** Who can see a drop in feeds / nearby lists. */
export function canViewerSeePlacement(
  p: Placement,
  viewerId: string | null,
): boolean {
  const visibility = p.visibility ?? "public";
  if (visibility === "public") return true;
  if (!viewerId) return false;
  if (p.createdBy === viewerId) return true;
  if (visibility === "pending_owner" && p.landOwnerId === viewerId) return true;
  return false;
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
    const [placementsRaw, zones] = await Promise.all([
      listJsonPrefix<Partial<Placement> & { id: string }>(PLACEMENT_PREFIX),
      listJsonPrefix<BanZone>(ZONE_PREFIX),
    ]);
    return {
      placements: placementsRaw.map(normalizePlacement),
      zones,
    };
  } catch (err) {
    console.error("Blob read failed:", err);
    return null;
  }
}

async function putJson(pathname: string, data: unknown) {
  await put(pathname, JSON.stringify(data), {
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
    const parsed = JSON.parse(raw) as StoreData;
    return {
      placements: (parsed.placements ?? []).map((p) =>
        normalizePlacement(p as Placement),
      ),
      zones: parsed.zones ?? [],
    };
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

export async function getPlacementById(id: string): Promise<Placement | null> {
  const store = await getStore();
  return store.placements.find((p) => p.id === id) ?? null;
}

export async function getPlacementBySnapCode(
  code: string,
): Promise<Placement | null> {
  const store = await getStore();
  const needle = code.trim().toUpperCase();
  return store.placements.find((p) => p.snapCode === needle) ?? null;
}

export async function addPlacement(placement: Placement): Promise<void> {
  const normalized = normalizePlacement(placement);
  if (blobEnabled()) {
    try {
      await putJson(`${PLACEMENT_PREFIX}${normalized.id}.json`, normalized);
      const mem = memoryGet();
      mem.placements = [
        normalized,
        ...mem.placements.filter((p) => p.id !== normalized.id),
      ];
      return;
    } catch (err) {
      console.error("Blob placement write failed:", err);
      if (process.env.VERCEL) throw err;
    }
  }

  const current = (await readFromFile()) ?? structuredClone(memoryGet());
  current.placements = [
    normalized,
    ...current.placements.filter((p) => p.id !== normalized.id),
  ].slice(0, 500);
  memorySet(current);
  const ok = await writeToFile(current);
  if (!ok && process.env.VERCEL) {
    throw new Error("Could not persist placement.");
  }
}

export async function updatePlacement(placement: Placement): Promise<void> {
  await addPlacement(normalizePlacement(placement));
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
      await putJson(`${ZONE_PREFIX}${zone.id}.json`, zone);
      const mem = memoryGet();
      mem.zones = [zone, ...mem.zones.filter((z) => z.id !== zone.id)];
      return;
    } catch (err) {
      console.error("Blob zone write failed:", err);
      if (process.env.VERCEL) throw err;
    }
  }

  const current = (await readFromFile()) ?? structuredClone(memoryGet());
  current.zones = [zone, ...current.zones.filter((z) => z.id !== zone.id)].slice(
    0,
    200,
  );
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

export async function addFind(find: FindEvent): Promise<void> {
  if (blobEnabled()) {
    await putJson(`${FIND_PREFIX}${find.id}.json`, find);
    return;
  }
  // Local fallback: stash on placement via memory only file sidecar
  const findsPath = path.join(process.cwd(), "data", "finds.json");
  let finds: FindEvent[] = [];
  try {
    finds = JSON.parse(await fs.readFile(findsPath, "utf8")) as FindEvent[];
  } catch {
    finds = [];
  }
  finds = [find, ...finds].slice(0, 2000);
  await fs.mkdir(path.dirname(findsPath), { recursive: true });
  await fs.writeFile(findsPath, JSON.stringify(finds, null, 2), "utf8");
}

export async function listFinds(placementId?: string): Promise<FindEvent[]> {
  if (blobEnabled()) {
    const all = await listJsonPrefix<FindEvent>(FIND_PREFIX);
    return placementId
      ? all.filter((f) => f.placementId === placementId)
      : all;
  }
  const findsPath = path.join(process.cwd(), "data", "finds.json");
  try {
    const finds = JSON.parse(await fs.readFile(findsPath, "utf8")) as FindEvent[];
    return placementId
      ? finds.filter((f) => f.placementId === placementId)
      : finds;
  } catch {
    return [];
  }
}

export async function addReaction(reaction: Reaction): Promise<void> {
  if (blobEnabled()) {
    await putJson(`${REACTION_PREFIX}${reaction.id}.json`, reaction);
    return;
  }
  const reactionsPath = path.join(process.cwd(), "data", "reactions.json");
  let reactions: Reaction[] = [];
  try {
    reactions = JSON.parse(
      await fs.readFile(reactionsPath, "utf8"),
    ) as Reaction[];
  } catch {
    reactions = [];
  }
  reactions = [
    reaction,
    ...reactions.filter(
      (r) =>
        !(
          r.placementId === reaction.placementId &&
          r.userId === reaction.userId &&
          r.emoji === reaction.emoji
        ),
    ),
  ].slice(0, 5000);
  await fs.mkdir(path.dirname(reactionsPath), { recursive: true });
  await fs.writeFile(reactionsPath, JSON.stringify(reactions, null, 2), "utf8");
}

export async function listReactions(placementId?: string): Promise<Reaction[]> {
  if (blobEnabled()) {
    const all = await listJsonPrefix<Reaction>(REACTION_PREFIX);
    return placementId
      ? all.filter((r) => r.placementId === placementId)
      : all;
  }
  const reactionsPath = path.join(process.cwd(), "data", "reactions.json");
  try {
    const reactions = JSON.parse(
      await fs.readFile(reactionsPath, "utf8"),
    ) as Reaction[];
    return placementId
      ? reactions.filter((r) => r.placementId === placementId)
      : reactions;
  } catch {
    return [];
  }
}

export async function listPermits(): Promise<LandPermit[]> {
  if (blobEnabled()) {
    return listJsonPrefix<LandPermit>(PERMIT_PREFIX);
  }
  const file = path.join(process.cwd(), "data", "permits.json");
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as LandPermit[];
  } catch {
    return [];
  }
}

export async function savePermit(permit: LandPermit): Promise<void> {
  if (blobEnabled()) {
    await putJson(`${PERMIT_PREFIX}${permit.id}.json`, permit);
    return;
  }
  const file = path.join(process.cwd(), "data", "permits.json");
  const all = await listPermits();
  const next = [permit, ...all.filter((p) => p.id !== permit.id)];
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(next, null, 2), "utf8");
}

export function persistenceMode(): "blob" | "file" | "memory" {
  if (blobToken() || process.env.VERCEL) return "blob";
  return "file";
}
