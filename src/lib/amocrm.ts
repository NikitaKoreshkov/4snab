// Тонкий клиент amoCRM API v4. Только серверный код.
import "server-only";
import { env } from "./env";

export interface AmoCustomFieldValue {
  field_id: number;
  field_name?: string;
  field_code?: string | null;
  field_type?: string;
  values: { value: unknown; enum_id?: number; enum_code?: string }[];
}

export interface AmoLead {
  id: number;
  name: string;
  price: number;
  status_id: number;
  pipeline_id: number;
  created_at: number;
  updated_at: number;
  custom_fields_values: AmoCustomFieldValue[] | null;
  _embedded?: {
    companies?: { id: number }[];
    contacts?: { id: number }[];
    tags?: { id: number; name: string }[];
  };
}

export interface AmoPipeline {
  id: number;
  name: string;
  _embedded: { statuses: { id: number; name: string; type: number }[] };
}

export interface AmoCustomField {
  id: number;
  name: string;
  code: string | null;
  type: string;
  entity_type: string;
}

class AmoError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = "AmoError";
  }
}

async function amoFetch<T>(
  path: string,
  init: RequestInit & { query?: Record<string, string | number | undefined> } = {},
): Promise<T> {
  const { query, ...rest } = init;
  const url = new URL(path, env.amocrm.baseUrl);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
  }

  const res = await fetch(url, {
    ...rest,
    headers: {
      Authorization: `Bearer ${env.amocrm.accessToken}`,
      "Content-Type": "application/json",
      ...rest.headers,
    },
    cache: "no-store",
  });

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const json = text ? JSON.parse(text) : undefined;

  if (!res.ok) {
    throw new AmoError(`amoCRM ${res.status} на ${path}`, res.status, json);
  }
  return json as T;
}

// ── Справочники ────────────────────────────────────────────────────────

export async function getPipelines(): Promise<AmoPipeline[]> {
  const data = await amoFetch<{ _embedded?: { pipelines: AmoPipeline[] } } | undefined>(
    "/api/v4/leads/pipelines",
  );
  return data?._embedded?.pipelines ?? [];
}

export async function getLeadCustomFields(): Promise<AmoCustomField[]> {
  const out: AmoCustomField[] = [];
  let page = 1;
  for (;;) {
    const data = await amoFetch<
      { _embedded?: { custom_fields: AmoCustomField[] } } | undefined
    >("/api/v4/leads/custom_fields", { query: { page, limit: 250 } });
    const chunk = data?._embedded?.custom_fields ?? [];
    out.push(...chunk);
    if (chunk.length < 250) break;
    page += 1;
  }
  return out;
}

// ── Сделки ────────────────────────────────────────────────────────────

export async function getLead(id: number): Promise<AmoLead> {
  return amoFetch<AmoLead>(`/api/v4/leads/${id}`, {
    query: { with: "companies,contacts" },
  });
}

export async function listLeadsByPipeline(
  pipelineId: number,
  statusId?: number,
): Promise<AmoLead[]> {
  const out: AmoLead[] = [];
  let page = 1;
  for (;;) {
    const data = await amoFetch<{ _embedded?: { leads: AmoLead[] } } | undefined>(
      "/api/v4/leads",
      {
        query: {
          "filter[pipeline_id]": pipelineId,
          "filter[statuses][0][pipeline_id]": statusId ? pipelineId : undefined,
          "filter[statuses][0][status_id]": statusId,
          with: "companies,contacts",
          page,
          limit: 250,
        },
      },
    );
    const chunk = data?._embedded?.leads ?? [];
    out.push(...chunk);
    if (chunk.length < 250) break;
    page += 1;
  }
  return out;
}

export interface CreateLeadInput {
  name: string;
  pipeline_id: number;
  status_id: number;
  custom_fields_values?: { field_id: number; values: { value: unknown }[] }[];
}

export async function createLead(input: CreateLeadInput): Promise<AmoLead> {
  const data = await amoFetch<{ _embedded: { leads: AmoLead[] } }>("/api/v4/leads", {
    method: "POST",
    body: JSON.stringify([input]),
  });
  return data._embedded.leads[0];
}

export interface UpdateLeadInput {
  status_id?: number;
  custom_fields_values?: { field_id: number; values: { value: unknown }[] }[];
  _embedded?: { tags: ({ id: number } | { name: string })[] };
}

export async function updateLead(id: number, input: UpdateLeadInput): Promise<void> {
  await amoFetch(`/api/v4/leads/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

/** Добавляет тег сделке, не затирая существующие. */
export async function addLeadTag(id: number, tagName: string): Promise<void> {
  const lead = await getLead(id);
  const current = lead._embedded?.tags ?? [];
  if (current.some((t) => t.name === tagName)) return;
  await updateLead(id, {
    _embedded: { tags: [...current.map((t) => ({ id: t.id })), { name: tagName }] },
  });
}

export async function leadHasTag(id: number, tagName: string): Promise<boolean> {
  const lead = await getLead(id);
  return (lead._embedded?.tags ?? []).some((t) => t.name === tagName);
}

/** Связать уже созданную сделку склада с исходной сделкой диспетчера. */
export async function linkLeads(skladLeadId: number, dispatchLeadId: number): Promise<void> {
  await amoFetch(`/api/v4/leads/${skladLeadId}/link`, {
    method: "POST",
    body: JSON.stringify([{ to_entity_id: dispatchLeadId, to_entity_type: "leads" }]),
  });
}

export interface AmoLink {
  to_entity_id: number;
  to_entity_type: string;
}

export async function getLeadLinks(leadId: number): Promise<AmoLink[]> {
  const data = await amoFetch<{ _embedded?: { links: AmoLink[] } } | undefined>(
    `/api/v4/leads/${leadId}/links`,
  );
  return data?._embedded?.links ?? [];
}

// ── Чтение значений кастомных полей ───────────────────────────────────

export function readFieldValue(lead: AmoLead, fieldId: number): unknown {
  const field = lead.custom_fields_values?.find((f) => f.field_id === fieldId);
  return field?.values?.[0]?.value;
}

export { AmoError };
