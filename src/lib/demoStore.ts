// Демо-режим: витрина интерфейса зав. склада без amoCRM и без SQLite.
// Включается, когда не задан WAREHOUSE_USERS: тогда ни одна ссылка /s/<token>
// не работала бы, и публичное демо показывало бы пустую страницу.
import "server-only";
import { env } from "./env";
import type { SaveWarehouseRequestInput, WarehouseDraft, WarehouseLineItem } from "./warehouse-types";
import type { RequestFile, ShipmentRequest } from "./requests";

export const DEMO_TOKEN = "demo-4snab";
export const DEMO_USER_NAME = "Елена, зав. складом";

export function isDemoMode(): boolean {
  return !env.warehouseUsersRaw;
}

const toMinor = (value: string | null) =>
  value ? Math.round(Number(value.replace(",", ".")) * 100) : null;

function line(
  id: number,
  material: { enumId: number; name: string; sortOrder: number },
  actualQuantity: string | null,
  unit: string | null,
  unitPrice: string | null,
): WarehouseLineItem {
  const unitPriceMinor = toMinor(unitPrice);
  const qty = actualQuantity ? Number(actualQuantity.replace(",", ".")) : null;
  return {
    id,
    materialEnumId: material.enumId,
    actualQuantity,
    unit,
    unitPrice,
    materialName: material.name,
    sortOrder: material.sortOrder,
    sourceActive: true,
    unitPriceMinor,
    amountMinor: unitPriceMinor !== null && qty ? Math.round(unitPriceMinor * qty) : null,
  };
}

function draftOf(items: WarehouseLineItem[], overrides: Partial<WarehouseDraft> = {}): WarehouseDraft {
  const materialSubtotalMinor = items.reduce((sum, i) => sum + (i.amountMinor ?? 0), 0);
  const palletCount = overrides.palletCount ?? null;
  const deliveryCostMinor = toMinor(overrides.deliveryCost ?? null);
  return {
    exists: true,
    legacy: false,
    status: "draft",
    version: 1,
    palletCount,
    deliveryCost: overrides.deliveryCost ?? null,
    deliveryCostMinor,
    materialSubtotalMinor,
    totalMinor: materialSubtotalMinor + (deliveryCostMinor ?? 0),
    items,
    updatedBy: DEMO_USER_NAME,
    updatedAt: "2026-04-18T09:20:00.000Z",
    completedBy: null,
    completedAt: null,
    ...overrides,
  };
}

const PALLETS = { enumId: 401, name: "Паллета EUR", sortOrder: 1 };
const FILM = { enumId: 402, name: "Стретч-плёнка 500мм", sortOrder: 2 };
const STRAP = { enumId: 403, name: "Лента упаковочная 12мм", sortOrder: 3 };
const BOX = { enumId: 404, name: "Короб 600×400×400", sortOrder: 4 };
const TAPE = { enumId: 405, name: "Скотч прозрачный 48мм", sortOrder: 5 };

let requests: ShipmentRequest[] = [
  {
    id: 90101,
    sourceLeadId: 88120,
    name: "Отгрузка ТД «Меридиан», 12 паллет",
    shipDate: "2026-04-21",
    company: "ТД «Меридиан»",
    description: "Паллеты, плёнка, обвязка. Машина к 08:00, рампа 3.",
    planQuantity: 12,
    sourceActualQuantity: null,
    materials: [PALLETS, FILM, STRAP],
    budget: 74000,
    statusId: 7001,
    isDone: false,
    createdAt: "2026-04-17T11:05:00.000Z",
    syncIssue: null,
    draft: draftOf([
      line(1, PALLETS, "12", "шт.", "480"),
      line(2, FILM, "6", "упак.", "1250"),
      line(3, STRAP, "2", "бухт.", "2100"),
    ], { palletCount: 12, deliveryCost: "9800" }),
  },
  {
    id: 90102,
    sourceLeadId: 88131,
    name: "Самовывоз «Пакдизайн»",
    shipDate: "2026-04-22",
    company: 'ООО «Пакдизайн»',
    description: "Клиент забирает своей машиной, нужны только документы.",
    planQuantity: 4,
    sourceActualQuantity: null,
    materials: [BOX, TAPE],
    budget: 21500,
    statusId: 7001,
    isDone: false,
    createdAt: "2026-04-18T07:40:00.000Z",
    syncIssue: null,
    draft: draftOf([line(1, BOX, "40", "шт.", "315"), line(2, TAPE, "24", "шт.", "98")]),
  },
  {
    id: 90103,
    sourceLeadId: 88144,
    name: "Складской переезд, корпус Б",
    shipDate: "2026-04-24",
    company: "Внутренний заказ",
    description: "Переместить остатки плёнки и обвязки между корпусами.",
    planQuantity: null,
    sourceActualQuantity: null,
    materials: [FILM, STRAP],
    budget: null,
    statusId: 7001,
    isDone: false,
    createdAt: "2026-04-19T13:15:00.000Z",
    syncIssue: null,
    draft: draftOf([line(1, FILM, "18", "упак.", "1250"), line(2, STRAP, "9", "бухт.", "2100")]),
  },
  {
    id: 90090,
    sourceLeadId: 88002,
    name: "Отгрузка «Фурнитура Плюс», апрель",
    shipDate: "2026-04-11",
    company: 'ООО «Фурнитура Плюс»',
    description: "Заявка закрыта, накладные переданы водителю.",
    planQuantity: 8,
    sourceActualQuantity: 8,
    materials: [PALLETS, BOX],
    budget: 46300,
    statusId: 7002,
    isDone: true,
    createdAt: "2026-04-09T09:00:00.000Z",
    syncIssue: null,
    draft: draftOf(
      [line(1, PALLETS, "8", "шт.", "480"), line(2, BOX, "20", "шт.", "315")],
      {
        status: "completed",
        palletCount: 8,
        deliveryCost: "6400",
        completedBy: DEMO_USER_NAME,
        completedAt: "2026-04-11T15:30:00.000Z",
        updatedAt: "2026-04-11T15:30:00.000Z",
        version: 3,
      },
    ),
  },
];

const filesByRequest = new Map<number, RequestFile[]>();

export function demoListRequests(scope: "open" | "done"): ShipmentRequest[] {
  return requests
    .filter((r) => (scope === "done" ? r.isDone : !r.isDone))
    .sort((a, b) => (a.shipDate ?? "9999").localeCompare(b.shipDate ?? "9999"));
}

export function demoCountRequests(scope: "open" | "done"): number {
  return demoListRequests(scope).length;
}

export function demoGetRequest(id: number): ShipmentRequest {
  const found = requests.find((r) => r.id === id);
  if (!found) throw new Error("Складская заявка не найдена");
  return found;
}

export function demoListRequestFiles(id: number): RequestFile[] {
  return filesByRequest.get(id) ?? [];
}

export function demoDetachRequestFile(id: number, uuid: string): void {
  const list = (filesByRequest.get(id) ?? []).filter((f) => f.uuid !== uuid);
  filesByRequest.set(id, list);
}

/** Сохранение черновика и завершение заявки считаются в памяти сервера. */
export function demoSaveRequest(
  id: number,
  input: SaveWarehouseRequestInput,
  actor: string,
): ShipmentRequest {
  const current = demoGetRequest(id);
  if (current.isDone) throw new Error("Завершённую заявку нельзя изменять");
  if (input.version !== current.draft.version) {
    throw new Error("Заявка уже изменена в другом окне. Обновите страницу и повторите.");
  }
  const materials = new Map(current.materials.map((m) => [m.enumId, m]));
  const items = input.items.map((item, index) =>
    line(
      index + 1,
      materials.get(item.materialEnumId) ?? {
        enumId: item.materialEnumId,
        name: "Позиция",
        sortOrder: index + 1,
      },
      item.actualQuantity,
      item.unit,
      item.unitPrice,
    ),
  );
  const completed = input.action === "complete";
  const now = new Date().toISOString();
  const draft = draftOf(items, {
    palletCount: input.palletCount,
    deliveryCost: input.deliveryCost,
    status: completed ? "completed" : "draft",
    version: input.version + 1,
    updatedBy: actor,
    updatedAt: now,
    completedBy: completed ? actor : null,
    completedAt: completed ? now : null,
  });
  requests = requests.map((r) => (r.id === id ? { ...r, draft, isDone: completed || r.isDone } : r));
  return demoGetRequest(id);
}
