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
