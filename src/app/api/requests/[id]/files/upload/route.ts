import type { NextRequest } from "next/server";
import { uploadFilePart, type AmoFile } from "@/lib/amocrm";
import { getUserByToken } from "@/lib/auth";
import { attachUploadedFileToRequest, getRequest } from "@/lib/requests";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_PROXY_PART_SIZE = 1024 * 1024;

function tokenFrom(request: NextRequest): string | null {
  return request.nextUrl.searchParams.get("token") || request.headers.get("x-warehouse-token");
}

export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/requests/[id]/files/upload">,
) {
  if (!getUserByToken(tokenFrom(request) ?? "")) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { id: rawId } = await ctx.params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    return new Response("Not found", { status: 404 });
  }

  const uploadUrl = request.headers.get("x-amo-upload-url");
  if (!uploadUrl) {
    return Response.json({ error: "Не указана сессия загрузки" }, { status: 400 });
  }

  const declaredSize = Number(request.headers.get("content-length"));
  if (declaredSize > MAX_PROXY_PART_SIZE) {
    return new Response("Часть файла слишком большая", { status: 413 });
  }

  try {
    await getRequest(id);
    const part = await request.arrayBuffer();
    if (!part.byteLength || part.byteLength > MAX_PROXY_PART_SIZE) {
      return new Response("Некорректный размер части файла", { status: 413 });
    }

    const progress = await uploadFilePart(uploadUrl, part);
    if (progress.next_url) {
      return Response.json({ complete: false, nextUrl: progress.next_url });
    }

    if (
      !progress.uuid ||
      !progress.version_uuid ||
      !progress.name ||
      typeof progress.size !== "number"
    ) {
      throw new Error("amoCRM не вернула загруженный файл");
    }

    const file: AmoFile = {
      uuid: progress.uuid,
      version_uuid: progress.version_uuid,
      name: progress.name,
      size: progress.size,
      type: progress.type ?? "file",
      created_at: progress.created_at ?? Math.floor(Date.now() / 1000),
      metadata: progress.metadata,
      previews: progress.previews,
      _links: progress._links,
    };
    const attached = await attachUploadedFileToRequest(id, file);
    return Response.json({ complete: true, file: attached });
  } catch (err) {
    console.error("POST /api/requests/[id]/files/upload", err);
    return new Response("Не удалось загрузить накладную", { status: 502 });
  }
}
