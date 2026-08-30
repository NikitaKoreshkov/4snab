// JSON API для одной заявки склада. Доступ по токену зав.склада.
//   GET   /api/requests/<id>?token=<token>
//   PATCH /api/requests/<id>?token=<token>   body: { quantity?, unitPrice, deliveryCost, markDone? }
import type { NextRequest } from "next/server";
import { z } from "zod";
import { getUserByToken } from "@/lib/auth";
import { getRequest, saveRequest } from "@/lib/requests";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function tokenFrom(request: NextRequest): string | null {
  return (
    request.nextUrl.searchParams.get("token") ||
    request.headers.get("x-warehouse-token")
  );
}

const patchSchema = z.object({
  quantity: z.number().min(0).nullable().optional(),
  unitPrice: z.number().min(0),
  deliveryCost: z.number().min(0),
  markDone: z.boolean().optional(),
});

export async function GET(
  request: NextRequest,
  ctx: RouteContext<"/api/requests/[id]">,
) {
  if (!getUserByToken(tokenFrom(request) ?? "")) {
    return new Response("Unauthorized", { status: 401 });
  }
  const { id } = await ctx.params;
  try {
    return Response.json(await getRequest(Number(id)));
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<"/api/requests/[id]">,
) {
  if (!getUserByToken(tokenFrom(request) ?? "")) {
    return new Response("Unauthorized", { status: 401 });
  }
  const { id } = await ctx.params;

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues }, { status: 400 });
  }

  try {
    const updated = await saveRequest(Number(id), {
      quantity: parsed.data.quantity ?? null,
      unitPrice: parsed.data.unitPrice,
      deliveryCost: parsed.data.deliveryCost,
      markDone: parsed.data.markDone ?? false,
    });
    return Response.json(updated);
  } catch (err) {
    console.error("PATCH /api/requests/[id]", err);
    return new Response("amoCRM error", { status: 502 });
  }
}
