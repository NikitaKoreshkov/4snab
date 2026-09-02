// Тонкий клиент amoCRM API v4. Только серверный код.
import "server-only";
import { env } from "./env";

export interface AmoCustomFieldValue {
  field_id: number;
  field_name?: string;
  field_code?: string | null;
  field_type?: string;
  values: { value: unknown; enum_id?: number; enum_code?: string | null }[];
}

export interface AmoFieldInputValue {
  value: unknown;
  enum_id?: number;
  enum_code?: string | null;
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

function parseResponseBody(text: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function validationDetails(body: unknown): string | null {
  if (!body || typeof body !== "object" || !("validation-errors" in body)) return null;
  const groups = (body as { "validation-errors"?: unknown })["validation-errors"];
  if (!Array.isArray(groups)) return null;
  const details = groups.flatMap((group) => {
    if (!group || typeof group !== "object") return [];
    const errors = (group as { errors?: unknown }).errors;
    if (!Array.isArray(errors)) return [];
    return errors.flatMap((error) => {
      if (!error || typeof error !== "object") return [];
      const item = error as { path?: unknown; detail?: unknown; code?: unknown };
      const path = typeof item.path === "string" ? item.path : "поле не указано";
      const detail =
        typeof item.detail === "string"
          ? item.detail
          : typeof item.code === "string"
            ? item.code
            : "ошибка валидации";
      return [`${path}: ${detail}`];
    });
  });
  return details.length ? details.join("; ") : null;
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
  const json = parseResponseBody(text);

  if (!res.ok) {
    const details = validationDetails(json);
    throw new AmoError(
      `amoCRM ${res.status} на ${path}${details ? ` — ${details}` : ""}`,
      res.status,
      json,
    );
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
  custom_fields_values?: { field_id: number; values: AmoFieldInputValue[] }[];
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
  custom_fields_values?: { field_id: number; values: AmoFieldInputValue[] }[];
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

// ── Файлы ─────────────────────────────────────────────────────────────

export interface AmoFile {
  uuid: string;
  version_uuid: string;
  name: string;
  sanitized_name?: string;
  size: number;
  type: string;
  created_at: number;
  metadata?: { extension?: string; mime_type?: string } | null;
  previews?: Array<{
    download_link: string;
    width?: number;
    height?: number;
  }> | null;
  _links?: {
    download?: { href: string };
    download_version?: { href: string };
  };
}

export interface AmoFileUploadSession {
  session_id: number;
  upload_url: string;
  max_file_size: number;
  max_part_size: number;
}

export interface AmoFileUploadProgress {
  session_id?: number;
  next_url?: string;
  uuid?: string;
  version_uuid?: string;
  name?: string;
  size?: number;
  type?: string;
  created_at?: number;
  metadata?: { extension?: string; mime_type?: string } | null;
  previews?: AmoFile["previews"];
  _links?: AmoFile["_links"];
}

interface AmoLeadFileLink {
  id: number;
  file_uuid: string;
}

let driveUrlPromise: Promise<string> | null = null;

export async function getDriveUrl(): Promise<string> {
  driveUrlPromise ??= amoFetch<{ drive_url?: string }>("/api/v4/account", {
    query: { with: "drive_url" },
  })
    .then((account) => {
      if (!account.drive_url) {
        throw new Error("amoCRM не вернула адрес файлового сервиса");
      }
      return account.drive_url;
    })
    .catch((err) => {
      driveUrlPromise = null;
      throw err;
    });
  return driveUrlPromise;
}

async function driveFetch<T>(url: URL, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.amocrm.accessToken}`,
      ...init.headers,
    },
    cache: "no-store",
  });

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const body = parseResponseBody(text);
  if (!res.ok) {
    throw new AmoError(`amoCRM Files ${res.status} на ${url.pathname}`, res.status, body);
  }
  return body as T;
}

export async function createFileUploadSession(input: {
  fileName: string;
  fileSize: number;
  contentType?: string;
}): Promise<AmoFileUploadSession> {
  const url = new URL("/v1.0/sessions", await getDriveUrl());
  return driveFetch<AmoFileUploadSession>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      file_name: input.fileName,
      file_size: input.fileSize,
      content_type: input.contentType || "application/octet-stream",
      with_preview: true,
    }),
  });
}

/**
 * Проксирует одну часть файла в amoCRM. URL сессионный, но всё равно строго
 * проверяем домен и путь, чтобы пользовательский заголовок нельзя было превратить в SSRF.
 */
export async function uploadFilePart(
  uploadUrl: string,
  part: ArrayBuffer,
): Promise<AmoFileUploadProgress> {
  const url = new URL(uploadUrl);
  const driveUrl = new URL(await getDriveUrl());
  if (
    url.protocol !== "https:" ||
    url.host !== driveUrl.host ||
    (!url.pathname.startsWith("/v1.0/sessions/upload/") &&
      !url.pathname.startsWith("/upload/"))
  ) {
    throw new Error("Некорректный адрес сессии загрузки");
  }

  return driveFetch<AmoFileUploadProgress>(url, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: part,
  });
}

/**
 * Загружает содержимое файла сервером, не раскрывая access token amoCRM браузеру.
 * URL принимается только с файлового домена текущего аккаунта.
 */
export async function downloadDriveFile(downloadUrl: string): Promise<Response> {
  const url = new URL(downloadUrl);
  const driveUrl = new URL(await getDriveUrl());
  if (
    url.protocol !== "https:" ||
    url.host !== driveUrl.host ||
    !url.pathname.startsWith("/download/")
  ) {
    throw new Error("Некорректный адрес файла amoCRM");
  }

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${env.amocrm.accessToken}` },
    cache: "no-store",
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new AmoError(
      `amoCRM Files ${response.status} при скачивании файла`,
      response.status,
      parseResponseBody(text),
    );
  }
  return response;
}

export async function getLeadFileLinks(leadId: number): Promise<AmoLeadFileLink[]> {
  const out: AmoLeadFileLink[] = [];
  let beforeId: number | undefined;
  const limit = 50;

  for (;;) {
    const data = await amoFetch<
      { _embedded?: { files: AmoLeadFileLink[] } } | undefined
    >(`/api/v4/leads/${leadId}/files`, {
      query: { limit, before_id: beforeId },
    });
    const chunk = data?._embedded?.files ?? [];
    out.push(...chunk);
    if (chunk.length < limit) break;

    const nextBeforeId = Math.min(...chunk.map((file) => file.id));
    if (nextBeforeId === beforeId) break;
    beforeId = nextBeforeId;
  }

  return out;
}

export async function getFilesByUuids(uuids: string[]): Promise<AmoFile[]> {
  const unique = [...new Set(uuids)].filter(Boolean);
  const out: AmoFile[] = [];
  const driveUrl = await getDriveUrl();

  for (let i = 0; i < unique.length; i += 50) {
    const batch = unique.slice(i, i + 50);
    const url = new URL("/v1.0/files", driveUrl);
    url.searchParams.set("filter[uuid]", batch.join(","));
    url.searchParams.set("limit", "50");
    const data = await driveFetch<
      { _embedded?: { files: AmoFile[] } } | undefined
    >(url);
    out.push(...(data?._embedded?.files ?? []));
  }

  return out;
}

export async function listLeadFiles(leadId: number): Promise<AmoFile[]> {
  const links = await getLeadFileLinks(leadId);
  const files = await getFilesByUuids(links.map((link) => link.file_uuid));
  return files.sort((a, b) => b.created_at - a.created_at);
}

export async function linkFilesToLead(leadId: number, fileUuids: string[]): Promise<void> {
  const unique = [...new Set(fileUuids)].filter(Boolean);
  for (let i = 0; i < unique.length; i += 50) {
    await amoFetch(`/api/v4/leads/${leadId}/files`, {
      method: "PUT",
      body: JSON.stringify(
        unique.slice(i, i + 50).map((fileUuid) => ({ file_uuid: fileUuid })),
      ),
    });
  }
}

// ── Чтение значений кастомных полей ───────────────────────────────────

export function readFieldValue(lead: AmoLead, fieldId: number): unknown {
  const field = lead.custom_fields_values?.find((f) => f.field_id === fieldId);
  return field?.values?.[0]?.value;
}

export function readFieldValues(
  lead: AmoLead,
  fieldId: number,
): AmoCustomFieldValue["values"] {
  const field = lead.custom_fields_values?.find((f) => f.field_id === fieldId);
  return field?.values ?? [];
}

export { AmoError };
