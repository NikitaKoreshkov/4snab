import type { NextRequest } from "next/server";
import { z } from "zod";
import { createFileUploadSession } from "@/lib/amocrm";
import { getUserByToken } from "@/lib/auth";
import { getRequest, listRequestFiles } from "@/lib/requests";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Каждая часть проходит через приложение, чтобы токен amoCRM не попадал в браузер.
// Небольшие части также не упираются в лимит размера тела serverless-запроса.
const MAX_PROXY_PART_SIZE = 1024 * 1024;

const uploadSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  fileSize: z.number().int().positive(),
  contentType: z.string().trim().max(150).optional(),
});

function tokenFrom(request: NextRequest): string | null {
  return request.nextUrl.searchParams.get("token") || request.headers.get("x-warehouse-token");
}

function requestId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function sanitizeFileName(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/]/g, "-")
    .trim()
    .slice(0, 255);
}

function isSupportedWaybill(fileName: string, contentType?: string): boolean {
  if (contentType?.startsWith("image/")) return true;
  if (contentType === "application/pdf") return true;
  return /\.(?:pdf|jpe?g|png|webp|heic|heif)$/i.test(fileName);
}

export async function GET(
  request: NextRequest,
  ctx: RouteContext<"/api/requests/[id]/files">,
) {
  if (!getUserByToken(tokenFrom(request) ?? "")) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { id: rawId } = await ctx.params;
  const id = requestId(rawId);
  if (!id) return new Response("Not found", { status: 404 });

  try {
    return Response.json({ files: await listRequestFiles(id) });
  } catch (err) {
    console.error("GET /api/requests/[id]/files", err);
    return new Response("Не удалось загрузить список накладных", { status: 502 });
  }
}

export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/requests/[id]/files">,
) {
  if (!getUserByToken(tokenFrom(request) ?? "")) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { id: rawId } = await ctx.params;
  const id = requestId(rawId);
  if (!id) return new Response("Not found", { status: 404 });

  const parsed = uploadSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Некорректные параметры файла" }, { status: 400 });
  }

  const fileName = sanitizeFileName(parsed.data.fileName);
  if (!fileName || !isSupportedWaybill(fileName, parsed.data.contentType)) {
    return Response.json(
      { error: "Можно загружать накладные в PDF или в формате изображения" },
      { status: 415 },
    );
  }

  try {
    await getRequest(id);
    const session = await createFileUploadSession({
      fileName,
      fileSize: parsed.data.fileSize,
      contentType: parsed.data.contentType,
    });

    return Response.json({
      uploadUrl: session.upload_url,
      maxFileSize: session.max_file_size,
      maxPartSize: Math.min(session.max_part_size, MAX_PROXY_PART_SIZE),
    });
  } catch (err) {
    console.error("POST /api/requests/[id]/files", err);
    return new Response("Не удалось начать загрузку накладной", { status: 502 });
  }
}
