// Доменный слой: amoCRM хранит маршрут заявки, SQLite — подробности склада.
import "server-only";
import { env, requireId } from "./env";
import {
  addLeadTag,
  createLead,
  getLead,
  getLeadFileLinks,
  getLeadLinks,
  leadHasTag,
  linkFilesToLead,
  linkLeads,
  listLeadFiles,
  listLeadsByPipeline,
  readFieldValues,
  updateLead,
  type AmoFieldInputValue,
  type AmoFile,
  type AmoLead,
} from "./amocrm";
import {
  sourceDate,
  sourceMaterials,
  sourceNumber,
  sourceText,
} from "./shipment-source";
import { hasPositiveActualQuantity, minorToDecimal } from "./warehouse-calculations";
import {
  getWarehouseRepository,
  legacyDraft,
  type StoredWarehouseFile,
} from "./warehouse-db";
import {
  WarehouseConflictError,
  WarehouseLockedError,
  WarehouseValidationError,
  type SaveWarehouseRequestInput,
  type SourceMaterial,
  type WarehouseDraft,
} from "./warehouse-types";

export interface ShipmentRequest {
  id: number;
  sourceLeadId: number | null;
  name: string;
  shipDate: string | null;
  company: string | null;
  description: string | null;
  planQuantity: number | null;
  sourceActualQuantity: number | null;
  materials: SourceMaterial[];
  budget: number | null;
  statusId: number;
  isDone: boolean;
  createdAt: string;
  draft: WarehouseDraft;
  syncIssue: string | null;
}

export interface RequestFile {
  uuid: string;
  name: string;
  size: number;
  type: string;
  createdAt: string;
  downloadUrl: string | null;
  previewUrl: string | null;
}

type CustomFieldInput = { field_id: number; values: AmoFieldInputValue[] };

function fieldId(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function requiredFieldId(value: string | undefined, name: string): number {
  return Number(requireId(value, name));
}

function explicitSourceDispatchLeadId(lead: AmoLead): number | null {
  const id = sourceNumber(lead, fieldId(env.fields.sourceLead));
  return id && Number.isInteger(id) && id > 0 ? id : null;
}

async function getSkladLead(id: number): Promise<AmoLead> {
  const lead = await getLead(id);
  const pipelineId = Number(requireId(env.pipelines.skladId, "AMOCRM_SKLAD_PIPELINE_ID"));
  if (lead.pipeline_id !== pipelineId) {
    throw new Error("Заявка не принадлежит воронке «Склад»");
  }
  return lead;
}

async function requireDispatchLead(id: number): Promise<AmoLead> {
  const lead = await getLead(id);
  const pipelineId = Number(
    requireId(env.pipelines.dispatchId, "AMOCRM_DISPATCH_PIPELINE_ID"),
  );
  if (lead.pipeline_id !== pipelineId) {
    throw new Error("Исходная сделка не принадлежит воронке диспетчера");
  }
  return lead;
}

async function resolveDispatchSource(
  skladLead: AmoLead,
): Promise<{ id: number; lead: AmoLead } | null> {
  const explicitId = explicitSourceDispatchLeadId(skladLead);
  if (explicitId) return { id: explicitId, lead: await requireDispatchLead(explicitId) };

  // Старые заявки могли быть созданы до появления явного поля источника.
  try {
    const links = await getLeadLinks(skladLead.id);
    for (const link of links) {
      if (link.to_entity_type !== "leads") continue;
      try {
        const lead = await requireDispatchLead(link.to_entity_id);
        return { id: lead.id, lead };
      } catch {
        // Связь может вести не на диспетчерскую сделку.
      }
    }
  } catch {
    // Некорректная старая заявка всё равно должна отображаться в списке.
  }
  return null;
}

function unlinkedDraft(materials: SourceMaterial[]): WarehouseDraft {
  return {
    exists: false,
    legacy: false,
    status: "draft",
    version: 0,
    palletCount: null,
    deliveryCost: null,
    deliveryCostMinor: null,
    materialSubtotalMinor: 0,
    totalMinor: 0,
    items: materials.map((material, index) => ({
      id: -(index + 1),
      materialEnumId: material.enumId,
      materialName: material.name,
      sortOrder: material.sortOrder,
      sourceActive: true,
      unit: null,
      actualQuantity: null,
      unitPrice: null,
      unitPriceMinor: null,
      amountMinor: null,
    })),
    updatedBy: null,
    updatedAt: null,
    completedBy: null,
    completedAt: null,
  };
}

function toRequestFile(file: AmoFile): RequestFile {
  return {
    uuid: file.uuid,
    name: file.name,
    size: file.size,
    type: file.metadata?.mime_type ?? file.type,
    createdAt: new Date(file.created_at * 1000).toISOString(),
    downloadUrl: file._links?.download?.href ?? null,
    previewUrl: file.previews?.[0]?.download_link ?? null,
  };
}

function storedRequestFile(file: StoredWarehouseFile): RequestFile {
  return {
    uuid: file.uuid,
    name: file.name,
    size: file.size,
    type: file.mimeType,
    createdAt: file.createdAt,
    downloadUrl: file.downloadUrl,
    previewUrl: file.previewUrl,
  };
}

function cacheRequestFile(warehouseLeadId: number, file: RequestFile, versionUuid?: string) {
  getWarehouseRepository().rememberRequestFile({
    warehouseLeadId,
    uuid: file.uuid,
    versionUuid: versionUuid ?? null,
    name: file.name,
    size: file.size,
    mimeType: file.type,
    createdAt: file.createdAt,
    downloadUrl: file.downloadUrl,
    previewUrl: file.previewUrl,
  });
}

async function syncFilesToLead(targetLeadId: number, fileUuids: string[]): Promise<void> {
  if (!fileUuids.length) return;
  const existing = new Set(
    (await getLeadFileLinks(targetLeadId)).map((link) => link.file_uuid),
  );
  const missing = [...new Set(fileUuids)].filter((uuid) => !existing.has(uuid));
  if (missing.length) await linkFilesToLead(targetLeadId, missing);
}

async function hydrateRequest(skladLead: AmoLead, actor: string): Promise<ShipmentRequest> {
  const resolvedSource = await resolveDispatchSource(skladLead);
  const sourceLeadId = resolvedSource?.id ?? null;
  const sourceLead = resolvedSource?.lead ?? skladLead;
  const materials = sourceMaterials(sourceLead, fieldId(env.fields.material));
  const doneStatusId = Number(
    requireId(env.pipelines.skladDoneStatusId, "AMOCRM_SKLAD_DONE_STATUS_ID"),
  );
  const amoIsDone = skladLead.status_id === doneStatusId;
  const repository = getWarehouseRepository();
  let draft: WarehouseDraft;
  if (!sourceLeadId) {
    draft = amoIsDone ? legacyDraft(materials) : unlinkedDraft(materials);
  } else {
    draft = repository.getDraft(skladLead.id);
    if (amoIsDone) {
      if (!draft.exists) {
        draft = legacyDraft(materials);
      } else if (draft.status !== "completed") {
        draft = repository.markCompleted(skladLead.id, "system-recovery");
      }
    } else if (!draft.exists || draft.status === "draft") {
      draft = repository.ensureDraft(skladLead.id, sourceLeadId, materials, actor);
    }
  }

  const storedBudget = sourceNumber(skladLead, fieldId(env.fields.budget));
  return {
    id: skladLead.id,
    sourceLeadId,
    name: skladLead.name,
    shipDate: sourceDate(sourceLead, fieldId(env.fields.shipDate)),
    company: sourceText(sourceLead, fieldId(env.fields.company)),
    description: sourceText(sourceLead, fieldId(env.fields.description)),
    planQuantity: sourceNumber(sourceLead, fieldId(env.fields.planQuantity)),
    sourceActualQuantity: sourceNumber(sourceLead, fieldId(env.fields.actualQuantity)),
    materials,
    budget:
      draft.exists && draft.deliveryCostMinor !== null
        ? Number(minorToDecimal(draft.totalMinor))
        : storedBudget,
    statusId: skladLead.status_id,
    isDone: amoIsDone || draft.status === "completed",
    createdAt: new Date(skladLead.created_at * 1000).toISOString(),
    draft,
    syncIssue:
      !sourceLeadId && !amoIsDone
        ? "У заявки нет связи с исходной сделкой диспетчера. Исправьте поле источника в amoCRM."
        : null,
  };
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const output = new Array<R>(values.length);
  let index = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (index < values.length) {
      const current = index;
      index += 1;
      output[current] = await mapper(values[current]);
    }
  });
  await Promise.all(workers);
  return output;
}

// ── Чтение ────────────────────────────────────────────────────────────

export async function listRequests(actor = "warehouse-view"): Promise<ShipmentRequest[]> {
  const pipelineId = Number(requireId(env.pipelines.skladId, "AMOCRM_SKLAD_PIPELINE_ID"));
  const newStatusId = Number(
    requireId(env.pipelines.skladNewStatusId, "AMOCRM_SKLAD_NEW_STATUS_ID"),
  );
  const doneStatusId = Number(
    requireId(env.pipelines.skladDoneStatusId, "AMOCRM_SKLAD_DONE_STATUS_ID"),
  );
  const [newLeads, doneLeads] = await Promise.all([
    listLeadsByPipeline(pipelineId, newStatusId),
    listLeadsByPipeline(pipelineId, doneStatusId),
  ]);
  const hiddenLeadIds = getWarehouseRepository().hiddenLeadIds();
  const leads = [
    ...new Map([...newLeads, ...doneLeads].map((lead) => [lead.id, lead])).values(),
  ].filter((lead) => !hiddenLeadIds.has(lead.id));
  const requests = await mapWithConcurrency(leads, 3, (lead) =>
    hydrateRequest(lead, actor),
  );
  return requests.sort((a, b) =>
    (a.shipDate ?? "9999").localeCompare(b.shipDate ?? "9999"),
  );
}

export async function getRequest(
  id: number,
  actor = "warehouse-view",
): Promise<ShipmentRequest> {
  if (getWarehouseRepository().hiddenLeadIds().has(id)) {
    throw new Error("Складская заявка скрыта");
  }
  return hydrateRequest(await getSkladLead(id), actor);
}

export async function listRequestFiles(id: number): Promise<RequestFile[]> {
  await getSkladLead(id);
  const repository = getWarehouseRepository();
  const cached = repository.requestFiles(id).map(storedRequestFile);
  let remote: RequestFile[] = [];
  try {
    const amoFiles = await listLeadFiles(id);
    remote = amoFiles.map(toRequestFile);
    amoFiles.forEach((file, index) =>
      cacheRequestFile(id, remote[index], file.version_uuid),
    );
  } catch (error) {
    // Уже загруженные приложением файлы остаются доступны даже при временной
    // ошибке или задержке индекса файлового API amoCRM.
    if (!cached.length) throw error;
    console.warn("listRequestFiles: используем локальный индекс", id, error);
  }

  const merged = new Map(cached.map((file) => [file.uuid, file]));
  remote.forEach((file) => merged.set(file.uuid, file));
  return [...merged.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getRequestFile(id: number, uuid: string): Promise<RequestFile> {
  const cached = getWarehouseRepository()
    .requestFiles(id)
    .find((candidate) => candidate.uuid === uuid);
  if (cached) return storedRequestFile(cached);

  const file = (await listRequestFiles(id)).find((candidate) => candidate.uuid === uuid);
  if (!file) throw new Error("Накладная не привязана к этой заявке");
  return file;
}

/** Привязывает файл к заявке и, после завершения, к сделке диспетчера. */
export async function attachUploadedFileToRequest(
  id: number,
  file: AmoFile,
): Promise<RequestFile> {
  const lead = await getSkladLead(id);
  await syncFilesToLead(id, [file.uuid]);
  const draft = getWarehouseRepository().getDraft(id);
  const doneStatusId = Number(
    requireId(env.pipelines.skladDoneStatusId, "AMOCRM_SKLAD_DONE_STATUS_ID"),
  );
  if (lead.status_id === doneStatusId || draft.status === "completed") {
    const source = await resolveDispatchSource(lead);
    if (source) await syncFilesToLead(source.id, [file.uuid]);
  }
  const attached = toRequestFile(file);
  cacheRequestFile(id, attached, file.version_uuid);
  return attached;
}

// ── Создание из сделки диспетчера (вебхук) ────────────────────────────

function carryField(source: AmoLead, id: number | null): CustomFieldInput | null {
  if (!id) return null;
  const values = readFieldValues(source, id);
  if (!values.length) return null;
  return {
    field_id: id,
    values: values.map((value) => {
      const input: AmoFieldInputValue = { value: value.value };
      if (typeof value.enum_id === "number") input.enum_id = value.enum_id;
      if (typeof value.enum_code === "string" && value.enum_code) {
        input.enum_code = value.enum_code;
      }
      return input;
    }),
  };
}

export async function createSkladRequestFromDispatch(
  dispatchLeadId: number,
): Promise<ShipmentRequest> {
  const skladPipelineId = Number(
    requireId(env.pipelines.skladId, "AMOCRM_SKLAD_PIPELINE_ID"),
  );
  const newStatusId = Number(
    requireId(env.pipelines.skladNewStatusId, "AMOCRM_SKLAD_NEW_STATUS_ID"),
  );
  const source = await requireDispatchLead(dispatchLeadId);
  const carryOver = [
    carryField(source, fieldId(env.fields.shipDate)),
    carryField(source, fieldId(env.fields.company)),
    carryField(source, fieldId(env.fields.planQuantity)),
    carryField(source, fieldId(env.fields.material)),
    carryField(source, fieldId(env.fields.description)),
  ].filter((value): value is CustomFieldInput => value !== null);

  carryOver.push({
    field_id: requiredFieldId(env.fields.sourceLead, "AMOCRM_FIELD_SOURCE_LEAD"),
    values: [{ value: dispatchLeadId }],
  });
  const created = await createLead({
    name: source.name || `Отгрузка #${dispatchLeadId}`,
    pipeline_id: skladPipelineId,
    status_id: newStatusId,
    custom_fields_values: carryOver,
  });

  try {
    await addLeadTag(dispatchLeadId, env.processedTag);
  } catch {
    // Тег — дополнительная защита от дублей; явное поле источника остаётся главным.
  }
  try {
    await linkLeads(created.id, dispatchLeadId);
  } catch {
    // Нативная связь сделок доступна не во всех аккаунтах.
  }

  const createdLead = await getLead(created.id);
  try {
    getWarehouseRepository().ensureDraft(
      created.id,
      dispatchLeadId,
      sourceMaterials(source, fieldId(env.fields.material)),
      "amo-webhook",
    );
  } catch (error) {
    console.error("Не удалось заранее создать складской черновик", error);
  }
  return hydrateRequest(createdLead, "amo-webhook");
}

export async function skladRequestExistsFor(dispatchLeadId: number): Promise<boolean> {
  if (await leadHasTag(dispatchLeadId, env.processedTag)) return true;
  const pipelineId = Number(requireId(env.pipelines.skladId, "AMOCRM_SKLAD_PIPELINE_ID"));
  const sourceFieldId = requiredFieldId(env.fields.sourceLead, "AMOCRM_FIELD_SOURCE_LEAD");
  const leads = await listLeadsByPipeline(pipelineId);
  return leads.some(
    (lead) => sourceNumber(lead, sourceFieldId) === dispatchLeadId,
  );
}

// ── Сохранение и завершение ──────────────────────────────────────────

function assertCompletion(request: ShipmentRequest, input: SaveWarehouseRequestInput): void {
  if (!request.company) throw new WarehouseValidationError("В amoCRM не указан объект");
  if (!request.shipDate) throw new WarehouseValidationError("В amoCRM не указана дата отгрузки");
  if (request.planQuantity === null) {
    throw new WarehouseValidationError("В amoCRM не указано плановое количество");
  }
  if (!request.materials.length) {
    throw new WarehouseValidationError("В amoCRM не выбран ни один материал");
  }
  if (input.palletCount === null || !Number.isInteger(input.palletCount) || input.palletCount < 0) {
    throw new WarehouseValidationError(
      "Количество поддонов должно быть целым неотрицательным числом",
    );
  }
  if (input.deliveryCost === null || String(input.deliveryCost).trim() === "") {
    throw new WarehouseValidationError("Укажите стоимость доставки, даже если она равна 0");
  }
  for (const source of request.draft.items.filter((item) => item.sourceActive)) {
    const item = input.items.find((candidate) => candidate.materialEnumId === source.materialEnumId);
    if (!item) throw new WarehouseConflictError();
    if (item.actualQuantity === null || String(item.actualQuantity).trim() === "") {
      throw new WarehouseValidationError(`Укажите фактическое количество: ${source.materialName}`);
    }
    if (!item.unit?.trim()) {
      throw new WarehouseValidationError(`Укажите единицу измерения: ${source.materialName}`);
    }
    if (item.unit.trim().length > 30) {
      throw new WarehouseValidationError(`Единица измерения слишком длинная: ${source.materialName}`);
    }
    if (item.unitPrice === null || String(item.unitPrice).trim() === "") {
      throw new WarehouseValidationError(`Укажите закупочную цену: ${source.materialName}`);
    }
  }
  if (!hasPositiveActualQuantity(input.items)) {
    throw new WarehouseValidationError(
      "Хотя бы у одной позиции фактическое количество должно быть больше 0",
    );
  }
}

function pushField(
  fields: CustomFieldInput[],
  id: number,
  value: unknown,
): void {
  fields.push({ field_id: id, values: [{ value }] });
}

async function synchronizeCompletion(
  skladLead: AmoLead,
  request: ShipmentRequest,
  draft: WarehouseDraft,
): Promise<void> {
  const dispatchLeadId = request.sourceLeadId;
  if (!dispatchLeadId) {
    throw new WarehouseValidationError(
      "У заявки нет связи с исходной сделкой диспетчера",
    );
  }
  await requireDispatchLead(dispatchLeadId);
  const fields: CustomFieldInput[] = [];
  pushField(
    fields,
    requiredFieldId(env.fields.deliveryCost, "AMOCRM_FIELD_DELIVERY_COST"),
    Number(minorToDecimal(draft.deliveryCostMinor)),
  );
  pushField(
    fields,
    requiredFieldId(env.fields.palletCount, "AMOCRM_FIELD_PALLET_COUNT"),
    draft.palletCount,
  );
  pushField(
    fields,
    requiredFieldId(env.fields.budget, "AMOCRM_FIELD_BUDGET"),
    Number(minorToDecimal(draft.totalMinor)),
  );

  const activeItems = draft.items.filter((item) => item.sourceActive);
  if (activeItems.length === 1) {
    const item = activeItems[0];
    pushField(
      fields,
      requiredFieldId(env.fields.actualQuantity, "AMOCRM_FIELD_ACTUAL_QUANTITY"),
      Number(item.actualQuantity),
    );
    pushField(
      fields,
      requiredFieldId(env.fields.unitPrice, "AMOCRM_FIELD_UNIT_PRICE"),
      Number(minorToDecimal(item.unitPriceMinor)),
    );
  }

  // Повтор каждого шага безопасен: PATCH заменяет значения, файлы дедуплицируются.
  await updateLead(dispatchLeadId, { custom_fields_values: fields });
  const fileUuids = (await getLeadFileLinks(request.id)).map((file) => file.file_uuid);
  await syncFilesToLead(dispatchLeadId, fileUuids);
  await updateLead(dispatchLeadId, {
    status_id: Number(
      requireId(
        env.pipelines.dispatchWaybillStatusId,
        "AMOCRM_DISPATCH_WAYBILL_STATUS_ID",
      ),
    ),
  });
  await updateLead(request.id, {
    custom_fields_values: fields,
    status_id: Number(
      requireId(env.pipelines.skladDoneStatusId, "AMOCRM_SKLAD_DONE_STATUS_ID"),
    ),
  });
}

export async function saveWarehouseRequest(
  id: number,
  input: SaveWarehouseRequestInput,
  actor: string,
): Promise<ShipmentRequest> {
  const skladLead = await getSkladLead(id);
  const request = await hydrateRequest(skladLead, actor);
  if (request.syncIssue) throw new WarehouseValidationError(request.syncIssue);
  if (request.isDone || request.draft.legacy || request.draft.status === "completed") {
    throw new WarehouseLockedError();
  }

  const repository = getWarehouseRepository();
  if (request.draft.status === "completing") {
    if (input.action !== "complete") throw new WarehouseLockedError();
    if (input.version !== request.draft.version) throw new WarehouseConflictError();
    await synchronizeCompletion(skladLead, request, request.draft);
    repository.markCompleted(id, actor);
    return getRequest(id, actor);
  }

  if (input.action === "complete") {
    assertCompletion(request, input);
    const files = await getLeadFileLinks(id);
    if (!files.length) {
      throw new WarehouseValidationError("Перед завершением добавьте хотя бы одну накладную");
    }
  }

  const draft = repository.saveDraft(
    id,
    input.version,
    input,
    actor,
    input.action === "complete" ? "completing" : "draft",
  );
  if (input.action === "draft") return getRequest(id, actor);

  await synchronizeCompletion(skladLead, request, draft);
  repository.markCompleted(id, actor);
  return getRequest(id, actor);
}
