import type { NextRequest } from "next/server";
import { downloadDriveFile } from "@/lib/amocrm";
import { getUserByToken } from "@/lib/auth";
import { detachRequestFile, getRequestFile } from "@/lib/requests";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function tokenFrom(request: NextRequest): string | null {
  return request.nextUrl.searchParams.get("token") || request.headers.get("x-warehouse-token");
}

function safeFileName(value: string): string {
  return (
    value
      .replace(/[\r\n"\\]/g, "_")
      .replace(/[^\x20-\x7e]/g, "_")
      .slice(0, 180) || "invoice"
  );
}

function parseFileParams(rawId: string, uuid: string): { id: number; uuid: string } | null {
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0 || !/^[a-zA-Z0-9-]{10,100}$/.test(uuid)) {
    return null;
  }
  return { id, uuid };
}

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ id: string; uuid: string }> },
) {
  if (!getUserByToken(tokenFrom(request) ?? "")) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { id: rawId, uuid } = await ctx.params;
  const params = parseFileParams(rawId, uuid);
  if (!params) return new Response("Not found", { status: 404 });

  try {
    const file = await getRequestFile(params.id, params.uuid);
    const usePreview = request.nextUrl.searchParams.get("variant") === "preview";
    const sourceUrl = (usePreview ? file.previewUrl : null) ?? file.downloadUrl;
    if (!sourceUrl) {
      return Response.json({ error: "Для файла нет ссылки скачивания" }, { status: 404 });
    }

    const upstream = await downloadDriveFile(sourceUrl);
    const headers = new Headers();
    const upstreamType = upstream.headers.get("content-type");
    const contentType = upstreamType || (file.type.includes("/") ? file.type : null);
    headers.set("Content-Type", contentType || "application/octet-stream");
    const contentLength = upstream.headers.get("content-length");
    if (contentLength) headers.set("Content-Length", contentLength);
    headers.set(
      "Content-Disposition",
      `inline; filename="${safeFileName(file.name)}"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    );
    headers.set("Cache-Control", "private, max-age=300");
    headers.set("X-Content-Type-Options", "nosniff");
    return new Response(upstream.body, { status: 200, headers });
  } catch (error) {
    console.error("GET /api/requests/[id]/files/[uuid]", error);
    return Response.json({ error: "Не удалось открыть накладную" }, { status: 502 });
  }
}

export async function DELETE(
  request: NextRequest,
  ctx: { params: Promise<{ id: string; uuid: string }> },
) {
  if (!getUserByToken(tokenFrom(request) ?? "")) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { id: rawId, uuid } = await ctx.params;
  const params = parseFileParams(rawId, uuid);
  if (!params) return new Response("Not found", { status: 404 });

  try {
    await detachRequestFile(params.id, params.uuid);
    return Response.json({ ok: true });
  } catch (error) {
    console.error("DELETE /api/requests/[id]/files/[uuid]", error);
    const message = error instanceof Error ? error.message : "";
    if (message.includes("не привязана")) {
      return Response.json({ error: "Накладная не привязана к этой заявке" }, { status: 404 });
    }
    return Response.json({ error: "Не удалось удалить накладную" }, { status: 502 });
  }
}
