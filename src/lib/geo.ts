const EARTH_RADIUS_M = 6371000;

export function toRad(deg: number) {
  return (deg * Math.PI) / 180;
}

export function toDeg(rad: number) {
  return (rad * 180) / Math.PI;
}

/** Haversine distance in meters */
export function distanceMeters(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
) {
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/** Bearing from A to B in degrees [0, 360) */
export function bearingDegrees(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
) {
  const φ1 = toRad(fromLat);
  const φ2 = toRad(toLat);
  const Δλ = toRad(toLng - fromLng);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) -
    Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

export function normalizeHeadingDelta(delta: number) {
  let d = ((delta + 180) % 360) - 180;
  if (d < -180) d += 360;
  return d;
}

export function pointInCircle(
  lat: number,
  lng: number,
  centerLat: number,
  centerLng: number,
  radiusMeters: number,
) {
  return distanceMeters(lat, lng, centerLat, centerLng) <= radiusMeters;
}
