import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { put, list } from "@vercel/blob";
import { connection } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type Comment = {
  id: string;
  placementId: string;
  userId: string;
  userName: string;
  text: string;
  createdAt: string;
};

async function listComments(placementId?: string): Promise<Comment[]> {
  if (process.env.BLOB_READ_WRITE_TOKEN || process.env.VERCEL) {
    const { blobs } = await list({ prefix: "comments/", limit: 1000 });
    const rows: Comment[] = [];
    for (const blob of blobs) {
      const res = await fetch(`${blob.url}?v=${Date.now()}`, {
        cache: "no-store",
      });
      if (!res.ok) continue;
      rows.push((await res.json()) as Comment);
    }
    return placementId
      ? rows.filter((c) => c.placementId === placementId)
      : rows;
  }

  const file = path.join(process.cwd(), "data", "comments.json");
  try {
    const rows = JSON.parse(await fs.readFile(file, "utf8")) as Comment[];
    return placementId
      ? rows.filter((c) => c.placementId === placementId)
      : rows;
  } catch {
    return [];
  }
}

export async function GET(request: Request) {
  await connection();
  const { searchParams } = new URL(request.url);
  const placementId = searchParams.get("placementId") ?? undefined;
  const comments = await listComments(placementId);
  comments.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  return NextResponse.json({ comments: comments.slice(0, 100) });
}

export async function POST(request: Request) {
  await connection();
  const body = (await request.json().catch(() => null)) as {
    placementId?: string;
    userId?: string;
    userName?: string;
    text?: string;
  } | null;

  if (!body?.placementId || !body.text?.trim()) {
    return NextResponse.json(
      { error: "placementId and text required" },
      { status: 400 },
    );
  }

  const comment: Comment = {
    id: randomUUID(),
    placementId: body.placementId,
    userId: (body.userId ?? "anonymous").slice(0, 40),
    userName: (body.userName ?? "Explorer").slice(0, 24),
    text: body.text.trim().slice(0, 200),
    createdAt: new Date().toISOString(),
  };

  if (process.env.BLOB_READ_WRITE_TOKEN || process.env.VERCEL) {
    await put(`comments/${comment.id}.json`, JSON.stringify(comment), {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
    });
  } else {
    const file = path.join(process.cwd(), "data", "comments.json");
    const existing = await listComments();
    const rows = [comment, ...existing].slice(0, 2000);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(rows, null, 2), "utf8");
  }

  return NextResponse.json({ comment }, { status: 201 });
}
