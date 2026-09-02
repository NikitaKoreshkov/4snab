// JSON API одной складской заявки.
import type { NextRequest } from "next/server";
import { z } from "zod";
import { getUserByToken } from "@/lib/auth";
import { getRequest, saveWarehouseRequest } from "@/lib/requests";
import {
  WarehouseConflictError,
  WarehouseLockedError,
  WarehouseValidationError,
} from "@/lib/warehouse-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function tokenFrom(request: NextRequest): string | null {
  return request.nextUrl.searchParams.get("token") || request.headers.get("x-warehouse-token");
}

const decimalSchema = z
  .union([z.string(), z.number()])
  .transform((value) => String(value))
  .refine((value) => /^\d+(?:[.,]\d+)?$/.test(value), "Укажите неотрицательное число")
  .nullable();

const patchSchema = z.object({
  action: z.enum(["draft", "complete"]),
  version: z.number().int().nonnegative(),
  palletCount: z.number().int().min(0).nullable(),
  deliveryCost: decimalSchema,
  items: z.array(
    z.object({
      materialEnumId: z.number().int(),
      actualQuantity: decimalSchema,
      unit: z.string().nullable(),
      unitPrice: decimalSchema,
    }),
  ),
});

export async function GET(
  request: NextRequest,
  context: RouteContext<"/api/requests/[id]">,
) {
  const user = getUserByToken(tokenFrom(request) ?? "");
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  const requestId = Number(id);
  if (!Number.isInteger(requestId) || requestId <= 0) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  try {
    return Response.json(await getRequest(requestId, user.name));
  } catch (error) {
    console.error("GET /api/requests/[id]", error);
    return Response.json({ error: "Not found" }, { status: 404 });
  }
}

export async function PATCH(
  request: NextRequest,
  context: RouteContext<"/api/requests/[id]">,
) {
  const user = getUserByToken(tokenFrom(request) ?? "");
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  const requestId = Number(id);
  if (!Number.isInteger(requestId) || requestId <= 0) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues }, { status: 400 });
  }

  try {
    return Response.json(
      await saveWarehouseRequest(requestId, parsed.data, user.name),
    );
  } catch (error) {
    console.error("PATCH /api/requests/[id]", error);
    if (error instanceof WarehouseConflictError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof WarehouseLockedError) {
      return Response.json({ error: error.message }, { status: 423 });
    }
    if (error instanceof WarehouseValidationError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    return Response.json(
      { error: "Не удалось синхронизировать заявку с amoCRM" },
      { status: 502 },
    );
  }
}
