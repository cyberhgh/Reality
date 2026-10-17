"use client";

export function getDeviceId() {
  if (typeof window === "undefined") return "server";
  const key = "reality-device-id";
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(key, id);
  }
  return id;
}

export function getDisplayName() {
  if (typeof window === "undefined") return "";
  return localStorage.getItem("reality-display-name") ?? "";
}

export function setDisplayName(name: string) {
  localStorage.setItem("reality-display-name", name.trim().slice(0, 24));
}

export function getAdminPinClient() {
  if (typeof window === "undefined") return "";
  return localStorage.getItem("reality-admin-pin") ?? "";
}

export function setAdminPinClient(pin: string) {
  localStorage.setItem("reality-admin-pin", pin);
}

export function adminHeaders(): HeadersInit {
  const pin = getAdminPinClient();
  return pin ? { "x-admin-pin": pin } : {};
}

export function getFoundIds(): string[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem("reality-found-ids") ?? "[]") as string[];
  } catch {
    return [];
  }
}

export function markFoundLocal(id: string) {
  const ids = new Set(getFoundIds());
  ids.add(id);
  localStorage.setItem("reality-found-ids", JSON.stringify([...ids]));
}

export function getFollowedCreators(): string[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(
      localStorage.getItem("reality-following") ?? "[]",
    ) as string[];
  } catch {
    return [];
  }
}

export function toggleFollowCreator(creatorId: string) {
  const set = new Set(getFollowedCreators());
  if (set.has(creatorId)) set.delete(creatorId);
  else set.add(creatorId);
  localStorage.setItem("reality-following", JSON.stringify([...set]));
  return [...set];
}
