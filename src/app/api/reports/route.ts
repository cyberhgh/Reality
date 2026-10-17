import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { put } from "@vercel/blob";
import { connection } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Report = {
  id: string;
  placementId: string;
  reporterId: string;
  reason: string;
  createdAt: string;
};

export async function POST(request: Request) {
  await connection();
  const body = (await request.json().catch(() => null)) as {
    placementId?: string;
    reporterId?: string;
    reason?: string;
  } | null;

  if (!body?.placementId || !body.reason) {
    return NextResponse.json(
      { error: "placementId and reason required" },
      { status: 400 },
    );
  }

  const report: Report = {
    id: randomUUID(),
    placementId: body.placementId,
    reporterId: (body.reporterId ?? "anonymous").slice(0, 40),
    reason: body.reason.slice(0, 240),
    createdAt: new Date().toISOString(),
  };

  if (process.env.BLOB_READ_WRITE_TOKEN || process.env.VERCEL) {
    await put(`reports/${report.id}.json`, JSON.stringify(report), {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
    });
  } else {
    const file = path.join(process.cwd(), "data", "reports.json");
    let rows: Report[] = [];
    try {
      rows = JSON.parse(await fs.readFile(file, "utf8")) as Report[];
    } catch {
      rows = [];
    }
    rows = [report, ...rows].slice(0, 500);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(rows, null, 2), "utf8");
  }

  return NextResponse.json({ ok: true, report }, { status: 201 });
}
