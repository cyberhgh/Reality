/**
 * Placement eligibility for "public places only" with private-land permits.
 *
 * Signals (best → fallback):
 * 1) Active land permit covering the point (owner/admin granted)
 * 2) Google Street View metadata (optional; needs GOOGLE_MAPS_API_KEY)
 * 3) OpenStreetMap Overpass: near public roads/paths/parks/plazas
 *
 * Street View / OSM are heuristics — not legal cadastral proofs.
 */

import { pointInCircle } from "./geo";

export type PlaceEligibility = {
  allowed: boolean;
  reason: string;
  source: "admin" | "permit" | "streetview" | "osm" | "policy_off" | "denied";
  details?: Record<string, unknown>;
};

export type LandPermit = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  radiusMeters: number;
  ownerId: string;
  ownerName: string;
  /** User ids allowed to place; include "*" to allow any registered member */
  allowedUserIds: string[];
  status: "pending" | "approved" | "revoked";
  /** Drops on this land are visible publicly to finders */
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

/** Query OSM for nearby publicly usable ways/areas. */
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
      // try next endpoint
    }
  }
  return { ok: false, error: "osm_unreachable" };
}

export function findCoveringPermit(
  lat: number,
  lng: number,
  userId: string,
  permits: LandPermit[],
): LandPermit | null {
  return (
    permits.find((p) => {
      if (p.status !== "approved") return false;
      const allowed =
        p.ownerId === userId ||
        p.allowedUserIds.includes(userId) ||
        p.allowedUserIds.includes("*");
      if (!allowed) return false;
      return pointInCircle(lat, lng, p.lat, p.lng, p.radiusMeters);
    }) ?? null
  );
}

export async function evaluatePublicPlace(opts: {
  lat: number;
  lng: number;
  userId: string;
  isAdmin: boolean;
  permits: LandPermit[];
}): Promise<PlaceEligibility> {
  if (opts.isAdmin) {
    return {
      allowed: true,
      reason: "Admin bypass",
      source: "admin",
    };
  }

  if (!policyEnabled()) {
    return {
      allowed: true,
      reason: "Public-place policy disabled",
      source: "policy_off",
    };
  }

  const permit = findCoveringPermit(
    opts.lat,
    opts.lng,
    opts.userId,
    opts.permits,
  );
  if (permit) {
    return {
      allowed: true,
      reason: `Permitted land: ${permit.name}`,
      source: "permit",
      details: { permitId: permit.id, makePublic: permit.makePublic },
    };
  }

  const sv = await hasStreetViewCoverage(opts.lat, opts.lng);
  if (sv.ok) {
    return {
      allowed: true,
      reason: "Street View coverage suggests public roadside access",
      source: "streetview",
      details: { status: sv.status },
    };
  }

  const osm = await hasOsmPublicAccess(opts.lat, opts.lng);
  if (osm.ok) {
    return {
      allowed: true,
      reason: `OpenStreetMap public way/area (${osm.matched})`,
      source: "osm",
      details: { matched: osm.matched },
    };
  }

  return {
    allowed: false,
    reason:
      "This spot does not look publicly accessible. Place on a public street/path/park, or request/use an approved land permit.",
    source: "denied",
    details: { streetView: sv, osm },
  };
}
