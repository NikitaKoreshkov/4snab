// Доменный слой: перевод между сделкой amoCRM и «заявкой на отгрузку».
import "server-only";
import { env, requireId } from "./env";
import {
  createLead,
  getLead,
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

/** amoCRM отдаёт даты кастомных полей как unix-таймстамп (сек). */
function dateStr(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  const d = Number.isFinite(n) ? new Date(n * 1000) : new Date(String(value));
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
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
  const f = env.fields.sklad;
  const quantity = num(f.quantity ? readFieldValue(lead, Number(f.quantity)) : null);
  const unitPrice = num(f.unitPrice ? readFieldValue(lead, Number(f.unitPrice)) : null);
  const deliveryCost = num(
    f.deliveryCost ? readFieldValue(lead, Number(f.deliveryCost)) : null,
  );
  const storedBudget = num(f.budget ? readFieldValue(lead, Number(f.budget)) : null);

  return {
    id: lead.id,
    name: lead.name,
    shipDate: f.shipDate ? dateStr(readFieldValue(lead, Number(f.shipDate))) : null,
    company: f.company ? str(readFieldValue(lead, Number(f.company))) : null,
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
  const df = env.fields.dispatch;
  const sf = env.fields.sklad;

  const shipDateRaw = df.shipDate ? readFieldValue(src, Number(df.shipDate)) : null;
  const companyRaw = df.company ? readFieldValue(src, Number(df.company)) : null;
  const quantityRaw = df.quantity ? readFieldValue(src, Number(df.quantity)) : null;

  const customFields: { field_id: number; values: { value: unknown }[] }[] = [];
  if (sf.shipDate && shipDateRaw != null)
    customFields.push({ field_id: Number(sf.shipDate), values: [{ value: shipDateRaw }] });
  if (sf.company && companyRaw != null)
    customFields.push({ field_id: Number(sf.company), values: [{ value: companyRaw }] });
  if (sf.quantity && quantityRaw != null)
    customFields.push({ field_id: Number(sf.quantity), values: [{ value: quantityRaw }] });

  const created = await createLead({
    name: src.name || `Отгрузка #${dispatchLeadId}`,
    pipeline_id: skladPipelineId,
    status_id: newStatusId,
    custom_fields_values: customFields.length ? customFields : undefined,
  });

  try {
    await linkLeads(created.id, dispatchLeadId);
  } catch {
    // связывание не критично для работы веб-инструмента
  }

  return toShipmentRequest(await getLead(created.id));
}

/** Уже есть складская сделка, связанная с этой сделкой диспетчера? */
export async function skladRequestExistsFor(dispatchLeadId: number): Promise<boolean> {
  const pipelineId = Number(requireId(env.pipelines.skladId, "AMOCRM_SKLAD_PIPELINE_ID"));
  const leads = await listLeadsByPipeline(pipelineId);
  const src = await getLead(dispatchLeadId);
  // эвристика: совпадение имени. Точную связь можно проверять через /links.
  return leads.some((l) => l.name === src.name);
}

// ── Сохранение зав.складом ───────────────────────────────────────────

export interface SaveRequestInput {
  unitPrice: number;
  deliveryCost: number;
  markDone: boolean;
}

export async function saveRequest(
  id: number,
  input: SaveRequestInput,
): Promise<ShipmentRequest> {
  const current = await getRequest(id);
  const sf = env.fields.sklad;

  const budget = calcBudget(current.quantity, input.unitPrice, input.deliveryCost);

  const customFields: { field_id: number; values: { value: unknown }[] }[] = [];
  if (sf.unitPrice)
    customFields.push({ field_id: Number(sf.unitPrice), values: [{ value: input.unitPrice }] });
  if (sf.deliveryCost)
    customFields.push({
      field_id: Number(sf.deliveryCost),
      values: [{ value: input.deliveryCost }],
    });
  if (sf.budget && budget !== null)
    customFields.push({ field_id: Number(sf.budget), values: [{ value: budget }] });

  await updateLead(id, {
    custom_fields_values: customFields.length ? customFields : undefined,
    status_id:
      input.markDone && env.pipelines.skladDoneStatusId
        ? Number(env.pipelines.skladDoneStatusId)
        : undefined,
  });

  return getRequest(id);
}
