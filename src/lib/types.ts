export type Placement = {
  id: string;
  emoji: string;
  label: string;
  note?: string;
  lat: number;
  lng: number;
  /** Optional altitude in meters if device provided it */
  altitude?: number | null;
  createdAt: string;
  createdBy: string;
  createdByName: string;
  byAdmin: boolean;
  /** Short code for QR / deep-link snap (non-GPS precise claim) */
  snapCode: string;
  findCount: number;
  reactionCount: number;
  /** Optional photo of the physical spot to help finders */
  landmarkUrl?: string | null;
  /** How the drop passed the public-place policy */
  placeSource?: "admin" | "permit" | "streetview" | "osm" | "policy_off" | string;
};

export type BanZone = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  radiusMeters: number;
  createdAt: string;
};

export type { LandPermit } from "./publicPlace";

export type FindEvent = {
  id: string;
  placementId: string;
  finderId: string;
  finderName: string;
  method: "gps" | "snap" | "manual";
  lat: number;
  lng: number;
  createdAt: string;
};

export type Reaction = {
  id: string;
  placementId: string;
  userId: string;
  userName: string;
  emoji: string;
  createdAt: string;
};

export type Profile = {
  id: string;
  name: string;
  createdAt: string;
  finds: number;
  placements: number;
};

export type StoreData = {
  placements: Placement[];
  zones: BanZone[];
};

export const PRESENCE_RADIUS_METERS = 40;
export const FIND_RADIUS_METERS = 45;
export const NEARBY_RADIUS_METERS = 250;
export const MAX_PLACE_ACCURACY_M = 35;
export const DEFAULT_EMOJIS = ["🗿", "⭐", "🦊", "💎", "🚀", "👻", "🏴‍☠️", "🪴", "🔮", "🎯"];
export const REACTION_EMOJIS = ["🔥", "😂", "😮", "❤️", "👀"];
