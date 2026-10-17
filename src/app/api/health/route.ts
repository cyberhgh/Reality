import { NextResponse } from "next/server";
import { list } from "@vercel/blob";
import { persistenceMode } from "@/lib/store";

export const runtime = "nodejs";

export async function GET() {
  const hasToken = Boolean(process.env.BLOB_READ_WRITE_TOKEN);
  let blobOk: boolean | null = null;
  let blobError: string | null = null;

  if (hasToken || process.env.VERCEL) {
    try {
      await list({ limit: 1 });
      blobOk = true;
    } catch (err) {
      blobOk = false;
      blobError = err instanceof Error ? err.message : "blob list failed";
    }
  }

  return NextResponse.json({
    ok: true,
    persistence: persistenceMode(),
    hasBlobToken: hasToken,
    blobOk,
    blobError,
    time: new Date().toISOString(),
  });
}
