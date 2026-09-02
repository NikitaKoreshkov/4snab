export const WAREHOUSE_UNITS = [
  "шт.",
  "т",
  "кг",
  "м³",
  "м²",
  "пог. м",
  "комплект",
  "рейс",
  "упак.",
] as const;

export type WarehouseRequestStatus = "draft" | "completing" | "completed";
export type WarehouseSaveAction = "draft" | "complete";

export interface SourceMaterial {
  enumId: number;
  name: string;
  sortOrder: number;
}

export interface WarehouseLineItemInput {
  materialEnumId: number;
  actualQuantity: string | null;
  unit: string | null;
  unitPrice: string | null;
}

export interface WarehouseLineItem extends WarehouseLineItemInput {
  id: number;
  materialName: string;
  sortOrder: number;
  sourceActive: boolean;
  unitPriceMinor: number | null;
  amountMinor: number | null;
}

export interface WarehouseDraft {
  exists: boolean;
  legacy: boolean;
  status: WarehouseRequestStatus;
  version: number;
  palletCount: number | null;
  deliveryCost: string | null;
  deliveryCostMinor: number | null;
  materialSubtotalMinor: number;
  totalMinor: number;
  items: WarehouseLineItem[];
  updatedBy: string | null;
  updatedAt: string | null;
  completedBy: string | null;
  completedAt: string | null;
}

export interface SaveWarehouseRequestInput {
  action: WarehouseSaveAction;
  version: number;
  palletCount: number | null;
  deliveryCost: string | null;
  items: WarehouseLineItemInput[];
}

export class WarehouseConflictError extends Error {
  constructor() {
    super("Заявка уже изменена в другом окне. Обновите страницу и повторите.");
    this.name = "WarehouseConflictError";
  }
}

export class WarehouseLockedError extends Error {
  constructor() {
    super("Завершённую заявку нельзя изменять");
    this.name = "WarehouseLockedError";
  }
}

export class WarehouseValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WarehouseValidationError";
  }
}
