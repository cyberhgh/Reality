/**
 * Public vs private land placement policy.
 *
 * - Public-access spots (Street View / OSM): drops are public immediately.
 * - Private spots: anyone may still place + view their own drop.
 *   Others only see it after the property owner (land permit holder) approves.
 *
 * Street View / OSM are heuristics — not legal cadastral proofs.
 */

import { pointInCircle } from "./geo";

export type Visibility = "public" | "private" | "pending_owner";

export type PlaceDecision = {
  /** Always true for placement itself (except ban zones / admin blocks handled elsewhere) */
  canPlace: boolean;
  visibility: Visibility;
  reason: string;
  source:
    | "admin"
    | "permit"
    | "streetview"
    | "osm"
    | "policy_off"
    | "private_land";
  landPermitId?: string | null;
  landOwnerId?: string | null;
  landOwnerName?: string | null;
  details?: Record<string, unknown>;
};

/** @deprecated use PlaceDecision — kept for place-check UI compatibility */
export type PlaceEligibility = {
  allowed: boolean;
  reason: string;
  source: PlaceDecision["source"] | "denied";
  details?: Record<string, unknown>;
  visibility?: Visibility;
  landOwnerName?: string | null;
};

export type LandPermit = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  radiusMeters: number;
  ownerId: string;
  ownerName: string;
  /** Users pre-approved to publish publicly on this land without per-drop review */
  allowedUserIds: string[];
  status: "pending" | "approved" | "revoked";
  makePublic: boolean;
  createdAt: string;
  approvedAt?: string | null;
};

function policyEnabled() {
  return (process.env.PUBLIC_PLACE_POLICY ?? "on").toLowerCase() !== "off";
}

export async function hasStreetViewCoverage(
  lat: number,
  lng: number,
): Promise<{ ok: boolean; status?: string; error?: string }> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return { ok: false, error: "no_google_key" };

  const url = new URL(
    "https://maps.googleapis.com/maps/api/streetview/metadata",
  );
  url.searchParams.set("location", `${lat},${lng}`);
  url.searchParams.set("radius", process.env.STREETVIEW_RADIUS_M ?? "40");
  url.searchParams.set("source", "outdoor");
  url.searchParams.set("key", key);

  try {
    const res = await fetch(url.toString(), { cache: "no-store" });
    const data = (await res.json()) as { status?: string };
    return { ok: data.status === "OK", status: data.status };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "streetview_failed",
    };
  }
}

export async function hasOsmPublicAccess(
  lat: number,
  lng: number,
): Promise<{ ok: boolean; matched?: string; error?: string }> {
  const radius = Number(process.env.OSM_PUBLIC_RADIUS_M ?? 35);
  const query = `
    [out:json][timeout:12];
    (
      way(around:${radius},${lat},${lng})["highway"~"^(footway|path|pedestrian|steps|living_street|residential|tertiary|secondary|primary|service|unclassified|cycleway|track)$"];
      way(around:${radius},${lat},${lng})["leisure"~"^(park|garden|common|playground)$"];
      relation(around:${radius},${lat},${lng})["leisure"~"^(park|garden|common)$"];
      way(around:${radius},${lat},${lng})["amenity"="marketplace"];
      way(around:${radius},${lat},${lng})["place"="square"];
      node(around:${radius},${lat},${lng})["highway"="bus_stop"];
    );
    out tags 8;
  `;

  const endpoints = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
  ];

  for (const endpoint of endpoints) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `data=${encodeURIComponent(query)}`,
        cache: "no-store",
      });
      if (!res.ok) continue;
      const data = (await res.json()) as {
        elements?: Array<{ tags?: Record<string, string> }>;
      };
      const el = data.elements?.[0];
      if (el) {
        const tags = el.tags ?? {};
        const matched =
          tags.highway || tags.leisure || tags.amenity || tags.place || "osm";
        if (tags.access === "private" || tags.access === "no") {
          return { ok: false, matched: `access=${tags.access}` };
        }
        return { ok: true, matched };
      }
      return { ok: false };
    } catch {
      // try next
    }
  }
  return { ok: false, error: "osm_unreachable" };
}

/** Any approved land claim covering the point (property owner registry). */
export function findLandOwnerPermit(
  lat: number,
  lng: number,
  permits: LandPermit[],
): LandPermit | null {
  return (
    permits.find(
      (p) =>
        p.status === "approved" &&
        pointInCircle(lat, lng, p.lat, p.lng, p.radiusMeters),
    ) ?? null
  );
}

export function placerHasPublishRights(
  userId: string,
  permit: LandPermit,
): boolean {
  return (
    permit.ownerId === userId ||
    permit.allowedUserIds.includes(userId) ||
    permit.allowedUserIds.includes("*")
  );
}

export async function decidePlacement(opts: {
  lat: number;
  lng: number;
  userId: string;
  isAdmin: boolean;
  permits: LandPermit[];
}): Promise<PlaceDecision> {
  if (opts.isAdmin) {
    return {
      canPlace: true,
      visibility: "public",
      reason: "Admin drop — public",
      source: "admin",
    };
  }

  if (!policyEnabled()) {
    return {
      canPlace: true,
      visibility: "public",
      reason: "Public-place policy disabled",
      source: "policy_off",
    };
  }

  const land = findLandOwnerPermit(opts.lat, opts.lng, opts.permits);
  if (land) {
    if (placerHasPublishRights(opts.userId, land) && land.makePublic) {
      return {
        canPlace: true,
        visibility: "public",
        reason: `On ${land.name} with owner publish rights — public`,
        source: "permit",
        landPermitId: land.id,
        landOwnerId: land.ownerId,
        landOwnerName: land.ownerName,
      };
    }
    // On claimed private land without publish rights → place privately, await owner.
    return {
      canPlace: true,
      visibility: "pending_owner",
      reason: `Private land (${land.name}). You can see it; ${land.ownerName} must approve for others.`,
      source: "private_land",
      landPermitId: land.id,
      landOwnerId: land.ownerId,
      landOwnerName: land.ownerName,
    };
  }

  const sv = await hasStreetViewCoverage(opts.lat, opts.lng);
  if (sv.ok) {
    return {
      canPlace: true,
      visibility: "public",
      reason: "Public-access area (Street View)",
      source: "streetview",
      details: { status: sv.status },
    };
  }

  const osm = await hasOsmPublicAccess(opts.lat, opts.lng);
  if (osm.ok) {
    return {
      canPlace: true,
      visibility: "public",
      reason: `Public-access area (OSM: ${osm.matched})`,
      source: "osm",
      details: { matched: osm.matched },
    };
  }

  // Unclaimed private / unknown land: place for yourself only.
  return {
    canPlace: true,
    visibility: "private",
    reason:
      "Private/unknown land. Only you can see this until a property owner claims the land and approves it.",
    source: "private_land",
    details: { streetView: sv, osm },
  };
}

export async function evaluatePublicPlace(opts: {
  lat: number;
  lng: number;
  userId: string;
  isAdmin: boolean;
  permits: LandPermit[];
}): Promise<PlaceEligibility> {
  const d = await decidePlacement(opts);
  return {
    allowed: d.canPlace,
    reason: d.reason,
    source: d.source,
    details: d.details,
    visibility: d.visibility,
    landOwnerName: d.landOwnerName ?? null,
  };
}
