// JSON API для списка заявок склада. Доступ по токену зав.склада.
//   GET /api/requests?token=<token>
import type { NextRequest } from "next/server";
import { getUserByToken } from "@/lib/auth";
import { listRequests } from "@/lib/requests";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function tokenFrom(request: NextRequest): string | null {
  return (
    request.nextUrl.searchParams.get("token") ||
    request.headers.get("x-warehouse-token")
  );
}

export async function GET(request: NextRequest) {
  const user = getUserByToken(tokenFrom(request) ?? "");
  if (!user) return new Response("Unauthorized", { status: 401 });

  try {
    const requests = await listRequests(user.name);
    return Response.json({ user: user.name, requests });
  } catch (err) {
    console.error("GET /api/requests", err);
    return new Response("amoCRM error", { status: 502 });
  }
}
