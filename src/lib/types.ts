export type Placement = {
  id: string;
  emoji: string;
  label: string;
  lat: number;
  lng: number;
  createdAt: string;
  createdBy: string;
  byAdmin: boolean;
};

export type BanZone = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  radiusMeters: number;
  createdAt: string;
};

export type StoreData = {
  placements: Placement[];
  zones: BanZone[];
};

export const PRESENCE_RADIUS_METERS = 40;
export const NEARBY_RADIUS_METERS = 250;
export const DEFAULT_EMOJIS = ["🗿", "⭐", "🦊", "💎", "🚀", "👻", "🏴‍☠️", "🪴"];
