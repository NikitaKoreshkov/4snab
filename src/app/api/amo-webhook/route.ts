// Вебхук amoCRM: срабатывает при смене этапа сделки.
// Настроить в amoCRM: события «Смена этапа» в воронке диспетчера,
// URL: https://<домен>/api/amo-webhook?secret=<AMOCRM_WEBHOOK_SECRET>
import type { NextRequest } from "next/server";
import { env } from "@/lib/env";
import {
  createSkladRequestFromDispatch,
  skladRequestExistsFor,
} from "@/lib/requests";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface StatusChange {
  id: number;
  statusId: number;
  pipelineId: number;
}

/** Разбирает form-urlencoded вида leads[status][0][id]=... в список изменений. */
function parseStatusChanges(form: FormData): StatusChange[] {
  const acc = new Map<string, Partial<StatusChange>>();
  const re = /^leads\[status]\[(\d+)]\[(id|status_id|pipeline_id)]$/;
  for (const [key, value] of form.entries()) {
    const m = re.exec(key);
    if (!m) continue;
    const [, idx, prop] = m;
    const entry = acc.get(idx) ?? {};
    const n = Number(value);
    if (prop === "id") entry.id = n;
    else if (prop === "status_id") entry.statusId = n;
    else if (prop === "pipeline_id") entry.pipelineId = n;
    acc.set(idx, entry);
  }
  return [...acc.values()].filter(
    (e): e is StatusChange =>
      typeof e.id === "number" &&
      typeof e.statusId === "number" &&
      typeof e.pipelineId === "number",
  );
}

export async function POST(request: NextRequest) {
  if (env.webhookSecret) {
    const secret = request.nextUrl.searchParams.get("secret");
    if (secret !== env.webhookSecret) {
      return new Response("forbidden", { status: 403 });
    }
  }

  const dispatchPipelineId = Number(env.pipelines.dispatchId);
  const shippingStatusId = Number(env.pipelines.dispatchShippingStatusId);
  if (!dispatchPipelineId || !shippingStatusId) {
    return new Response("webhook not configured", { status: 503 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return new Response("bad payload", { status: 400 });
  }

  const changes = parseStatusChanges(form).filter(
    (c) => c.pipelineId === dispatchPipelineId && c.statusId === shippingStatusId,
  );

  const results: Record<string, string> = {};
  for (const change of changes) {
    try {
      if (await skladRequestExistsFor(change.id)) {
        results[change.id] = "already exists";
        continue;
      }
      const created = await createSkladRequestFromDispatch(change.id);
      results[change.id] = `created sklad lead ${created.id}`;
    } catch (err) {
      console.error("amo-webhook: не удалось создать заявку", change.id, err);
      results[change.id] = "error";
    }
  }

  return Response.json({ ok: true, processed: results });
}

// amoCRM при сохранении вебхука дёргает GET для проверки доступности
export async function GET() {
  return Response.json({ ok: true });
}
