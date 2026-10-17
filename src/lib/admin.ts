export function getAdminPin() {
  return process.env.ADMIN_PIN ?? "reality-admin";
}

export function isAdminRequest(request: Request) {
  const pin = request.headers.get("x-admin-pin") ?? "";
  return pin.length > 0 && pin === getAdminPin();
}
