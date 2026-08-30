// Доменный слой: перевод между сделкой amoCRM и «заявкой на отгрузку».
import "server-only";
import { env, requireId } from "./env";
import {
  addLeadTag,
  createLead,
  getLead,
  leadHasTag,
  linkLeads,
  listLeadsByPipeline,
  readFieldValue,
  updateLead,
  type AmoLead,
} from "./amocrm";

export interface ShipmentRequest {
  id: number;
  name: string;
  /** Дата отгрузки, ISO yyyy-mm-dd или null */
  shipDate: string | null;
  company: string | null;
  quantity: number | null;
  unitPrice: number | null;
  deliveryCost: number | null;
  budget: number | null;
  statusId: number;
  isDone: boolean;
  createdAt: string;
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function str(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s || null;
}

/**
 * amoCRM отдаёт даты кастомных полей как unix-таймстамп (сек) на 00:00 в таймзоне
 * аккаунта. Сдвигаем на 12 часов, чтобы не словить off-by-one при переводе в UTC-дату.
 */
function dateStr(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  const d = Number.isFinite(n)
    ? new Date(n * 1000 + 12 * 3600 * 1000)
    : new Date(String(value));
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function fieldId(value: string | undefined): number | null {
  return value ? Number(value) : null;
}

function read(lead: AmoLead, id: number | null): unknown {
  return id ? readFieldValue(lead, id) : null;
}

export function calcBudget(
  quantity: number | null,
  unitPrice: number | null,
  deliveryCost: number | null,
): number | null {
  if (quantity === null || unitPrice === null) return null;
  return quantity * unitPrice + (deliveryCost ?? 0);
}

function toShipmentRequest(lead: AmoLead): ShipmentRequest {
  const quantity = num(read(lead, fieldId(env.fields.quantity)));
  const unitPrice = num(read(lead, fieldId(env.fields.unitPrice)));
  const deliveryCost = num(read(lead, fieldId(env.fields.deliveryCost)));
  const storedBudget = num(read(lead, fieldId(env.fields.budget)));

  return {
    id: lead.id,
    name: lead.name,
    shipDate: dateStr(read(lead, fieldId(env.fields.shipDate))),
    company: str(read(lead, fieldId(env.fields.company))),
    quantity,
    unitPrice,
    deliveryCost,
    budget: storedBudget ?? calcBudget(quantity, unitPrice, deliveryCost),
    statusId: lead.status_id,
    isDone: lead.status_id === Number(env.pipelines.skladDoneStatusId),
    createdAt: new Date(lead.created_at * 1000).toISOString(),
  };
}

// ── Чтение ────────────────────────────────────────────────────────────

export async function listRequests(): Promise<ShipmentRequest[]> {
  const pipelineId = Number(requireId(env.pipelines.skladId, "AMOCRM_SKLAD_PIPELINE_ID"));
  const leads = await listLeadsByPipeline(pipelineId);
  return leads
    .map(toShipmentRequest)
    .sort((a, b) => (a.shipDate ?? "9999").localeCompare(b.shipDate ?? "9999"));
}

export async function getRequest(id: number): Promise<ShipmentRequest> {
  const lead = await getLead(id);
  const pipelineId = Number(requireId(env.pipelines.skladId, "AMOCRM_SKLAD_PIPELINE_ID"));
  if (lead.pipeline_id !== pipelineId) {
    throw new Error("Заявка не принадлежит воронке «Склад»");
  }
  return toShipmentRequest(lead);
}

// ── Создание из сделки диспетчера (вызывается вебхуком) ───────────────

type Cfv = { field_id: number; values: { value: unknown }[] };

export async function createSkladRequestFromDispatch(
  dispatchLeadId: number,
): Promise<ShipmentRequest> {
  const skladPipelineId = Number(
    requireId(env.pipelines.skladId, "AMOCRM_SKLAD_PIPELINE_ID"),
  );
  const newStatusId = Number(
    requireId(env.pipelines.skladNewStatusId, "AMOCRM_SKLAD_NEW_STATUS_ID"),
  );

  const src = await getLead(dispatchLeadId);

  // Переносим в складскую сделку то, что уже заполнено диспетчером.
  const carryOver: Cfv[] = [];
  for (const id of [
    fieldId(env.fields.shipDate),
    fieldId(env.fields.company),
    fieldId(env.fields.quantity),
  ]) {
    if (!id) continue;
    const value = readFieldValue(src, id);
    if (value !== null && value !== undefined && value !== "") {
      carryOver.push({ field_id: id, values: [{ value }] });
    }
  }

  // ссылка на исходную сделку — для отчёта «Табель отгрузки» и защиты от дублей
  const sourceFieldId = fieldId(env.fields.sourceLead);
  if (sourceFieldId) {
    carryOver.push({ field_id: sourceFieldId, values: [{ value: dispatchLeadId }] });
  }

  const created = await createLead({
    name: src.name || `Отгрузка #${dispatchLeadId}`,
    pipeline_id: skladPipelineId,
    status_id: newStatusId,
    custom_fields_values: carryOver.length ? carryOver : undefined,
  });

  // пометить сделку диспетчера как обработанную (для дедупликации вебхука)
  try {
    await addLeadTag(dispatchLeadId, env.processedTag);
  } catch {
    // некритично
  }
  // нативная связь сделок (может быть недоступна в аккаунте — не критично)
  try {
    await linkLeads(created.id, dispatchLeadId);
  } catch {
    /* noop */
  }

  return toShipmentRequest(await getLead(created.id));
}

/**
 * Уже создавалась складская сделка для этой сделки диспетчера?
 * Проверяем по тегу на сделке диспетчера — это чтение по ID, без задержек индексации.
 */
export async function skladRequestExistsFor(dispatchLeadId: number): Promise<boolean> {
  return leadHasTag(dispatchLeadId, env.processedTag);
}

// ── Сохранение зав.складом ───────────────────────────────────────────

export interface SaveRequestInput {
  quantity: number | null;
  unitPrice: number;
  deliveryCost: number;
  markDone: boolean;
}

export async function saveRequest(
  id: number,
  input: SaveRequestInput,
): Promise<ShipmentRequest> {
  const current = await getRequest(id);
  const quantity = input.quantity ?? current.quantity;
  const budget = calcBudget(quantity, input.unitPrice, input.deliveryCost);

  const cfv: Cfv[] = [];
  const push = (fid: number | null, value: unknown) => {
    if (fid && value !== null && value !== undefined) {
      cfv.push({ field_id: fid, values: [{ value }] });
    }
  };
  push(fieldId(env.fields.quantity), input.quantity);
  push(fieldId(env.fields.unitPrice), input.unitPrice);
  push(fieldId(env.fields.deliveryCost), input.deliveryCost);
  push(fieldId(env.fields.budget), budget);

  await updateLead(id, {
    custom_fields_values: cfv.length ? cfv : undefined,
    status_id:
      input.markDone && env.pipelines.skladDoneStatusId
        ? Number(env.pipelines.skladDoneStatusId)
        : undefined,
  });

  return getRequest(id);
}
