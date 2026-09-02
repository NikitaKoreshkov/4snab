import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AmoLead } from "../amocrm";
import type { WarehouseDraft, WarehouseLineItem } from "../warehouse-types";
import { WarehouseValidationError } from "../warehouse-types";

const mocks = vi.hoisted(() => {
  const state: { draft: WarehouseDraft | null } = { draft: null };
  return {
    state,
    getLead: vi.fn(),
    createLead: vi.fn(),
    updateLead: vi.fn(),
    getLeadFileLinks: vi.fn(),
    getLeadLinks: vi.fn(),
    linkFilesToLead: vi.fn(),
    addLeadTag: vi.fn(),
    leadHasTag: vi.fn(),
    linkLeads: vi.fn(),
    listLeadFiles: vi.fn(),
    listLeadsByPipeline: vi.fn(),
    repository: {
      hiddenLeadIds: vi.fn(),
      getDraft: vi.fn(),
      ensureDraft: vi.fn(),
      saveDraft: vi.fn(),
      markCompleted: vi.fn(),
    },
  };
});

vi.mock("../amocrm", () => ({
  getLead: mocks.getLead,
  createLead: mocks.createLead,
  updateLead: mocks.updateLead,
  getLeadFileLinks: mocks.getLeadFileLinks,
  getLeadLinks: mocks.getLeadLinks,
  linkFilesToLead: mocks.linkFilesToLead,
  addLeadTag: mocks.addLeadTag,
  leadHasTag: mocks.leadHasTag,
  linkLeads: mocks.linkLeads,
  listLeadFiles: mocks.listLeadFiles,
  listLeadsByPipeline: mocks.listLeadsByPipeline,
  readFieldValue: (lead: AmoLead, id: number) =>
    lead.custom_fields_values?.find((field) => field.field_id === id)?.values[0]?.value,
  readFieldValues: (lead: AmoLead, id: number) =>
    lead.custom_fields_values?.find((field) => field.field_id === id)?.values ?? [],
}));

vi.mock("../warehouse-db", () => ({
  getWarehouseRepository: () => mocks.repository,
  legacyDraft: () => ({
    exists: false,
    legacy: true,
    status: "completed",
    version: 0,
    palletCount: null,
    deliveryCost: null,
    deliveryCostMinor: null,
    materialSubtotalMinor: 0,
    totalMinor: 0,
    items: [],
    updatedBy: null,
    updatedAt: null,
    completedBy: null,
    completedAt: null,
  }),
}));

import {
  createSkladRequestFromDispatch,
  getRequest,
  saveWarehouseRequest,
} from "../requests";

const DISPATCH_ID = 500;
const WAREHOUSE_ID = 1000;

function line(enumId: number, name: string, sortOrder: number): WarehouseLineItem {
  return {
    id: sortOrder + 1,
    materialEnumId: enumId,
    materialName: name,
    sortOrder,
    sourceActive: true,
    actualQuantity: null,
    unit: null,
    unitPrice: null,
    unitPriceMinor: null,
    amountMinor: null,
  };
}

function draft(items: WarehouseLineItem[]): WarehouseDraft {
  return {
    exists: true,
    legacy: false,
    status: "draft",
    version: 2,
    palletCount: null,
    deliveryCost: null,
    deliveryCostMinor: null,
    materialSubtotalMinor: 0,
    totalMinor: 0,
    items,
    updatedBy: null,
    updatedAt: new Date().toISOString(),
    completedBy: null,
    completedAt: null,
  };
}

function dispatchLead(
  materials: Array<{ value: string; enum_id: number; enum_code?: string | null }> = [
    { value: "ПГС", enum_id: 101 },
  ],
  company = "Объект",
): AmoLead {
  return {
    id: DISPATCH_ID,
    name: "Поставка",
    price: 0,
    pipeline_id: 100,
    status_id: 101,
    created_at: 1_700_000_000,
    updated_at: 1_700_000_000,
    custom_fields_values: [
      { field_id: 1, values: [{ value: 1_788_134_400 }] },
      ...(company ? [{ field_id: 2, values: [{ value: company }] }] : []),
      { field_id: 3, values: [{ value: 1000 }] },
      { field_id: 5, values: materials },
      { field_id: 6, values: [{ value: "К воротам №2" }] },
    ],
  } as AmoLead;
}

function warehouseLead(): AmoLead {
  return {
    id: WAREHOUSE_ID,
    name: "Складская поставка",
    price: 0,
    pipeline_id: 200,
    status_id: 201,
    created_at: 1_700_000_000,
    updated_at: 1_700_000_000,
    custom_fields_values: [{ field_id: 11, values: [{ value: DISPATCH_ID }] }],
  };
}

function completionInput(items: WarehouseLineItem[]) {
  return {
    action: "complete" as const,
    version: mocks.state.draft?.version ?? 2,
    palletCount: 4,
    deliveryCost: "5000",
    items: items.map((item, index) => ({
      materialEnumId: item.materialEnumId,
      actualQuantity: index === 0 ? "10.5" : "2",
      unit: index === 0 ? "т" : "шт.",
      unitPrice: index === 0 ? "300" : "50",
    })),
  };
}

describe("requests amoCRM integration", () => {
  let source: AmoLead;
  let warehouse: AmoLead;

  beforeEach(() => {
    process.env.AMOCRM_DISPATCH_PIPELINE_ID = "100";
    process.env.AMOCRM_DISPATCH_WAYBILL_STATUS_ID = "102";
    process.env.AMOCRM_SKLAD_PIPELINE_ID = "200";
    process.env.AMOCRM_SKLAD_NEW_STATUS_ID = "201";
    process.env.AMOCRM_SKLAD_DONE_STATUS_ID = "202";
    process.env.AMOCRM_FIELD_SHIP_DATE = "1";
    process.env.AMOCRM_FIELD_COMPANY = "2";
    process.env.AMOCRM_FIELD_PLAN_QUANTITY = "3";
    process.env.AMOCRM_FIELD_ACTUAL_QUANTITY = "4";
    process.env.AMOCRM_FIELD_MATERIAL = "5";
    process.env.AMOCRM_FIELD_DESCRIPTION = "6";
    process.env.AMOCRM_FIELD_UNIT_PRICE = "7";
    process.env.AMOCRM_FIELD_DELIVERY_COST = "8";
    process.env.AMOCRM_FIELD_PALLET_COUNT = "9";
    process.env.AMOCRM_FIELD_BUDGET = "10";
    process.env.AMOCRM_FIELD_SOURCE_LEAD = "11";

    source = dispatchLead();
    warehouse = warehouseLead();
    mocks.state.draft = draft([line(101, "ПГС", 0)]);
    mocks.repository.hiddenLeadIds.mockReturnValue(new Set());
    mocks.getLead.mockImplementation(async (id: number) =>
      id === DISPATCH_ID ? source : warehouse,
    );
    mocks.createLead.mockResolvedValue(warehouse);
    mocks.updateLead.mockResolvedValue(undefined);
    mocks.getLeadFileLinks.mockImplementation(async (id: number) =>
      id === WAREHOUSE_ID ? [{ id: 1, file_uuid: "invoice-1" }] : [],
    );
    mocks.getLeadLinks.mockResolvedValue([]);
    mocks.repository.getDraft.mockImplementation(() => mocks.state.draft);
    mocks.repository.ensureDraft.mockImplementation(() => mocks.state.draft);
    mocks.repository.saveDraft.mockImplementation((_id, _version, input) => {
      const current = mocks.state.draft!;
      const savedItems = current.items.map((item) => {
        const value = input.items.find(
          (candidate: { materialEnumId: number }) =>
            candidate.materialEnumId === item.materialEnumId,
        );
        return {
          ...item,
          actualQuantity: value?.actualQuantity ?? null,
          unit: value?.unit ?? null,
          unitPrice: value?.unitPrice ?? null,
          unitPriceMinor: value?.unitPrice ? Number(value.unitPrice) * 100 : null,
        };
      });
      mocks.state.draft = {
        ...current,
        status: "completing",
        version: current.version + 1,
        palletCount: input.palletCount,
        deliveryCost: input.deliveryCost,
        deliveryCostMinor: 500000,
        materialSubtotalMinor: savedItems.length === 1 ? 315000 : 325000,
        totalMinor: savedItems.length === 1 ? 815000 : 825000,
        items: savedItems,
      };
      return mocks.state.draft;
    });
    mocks.repository.markCompleted.mockImplementation(() => {
      mocks.state.draft = {
        ...mocks.state.draft!,
        status: "completed",
        version: mocks.state.draft!.version + 1,
      };
      return mocks.state.draft;
    });
  });

  it("copies every multiselect material into the warehouse lead", async () => {
    source = dispatchLead([
      { value: "ПГС", enum_id: 101, enum_code: null },
      { value: "Щебень", enum_id: 202, enum_code: null },
    ]);
    mocks.state.draft = draft([line(101, "ПГС", 0), line(202, "Щебень", 1)]);

    await createSkladRequestFromDispatch(DISPATCH_ID);

    const payload = mocks.createLead.mock.calls[0][0];
    const materialField = payload.custom_fields_values.find(
      (field: { field_id: number }) => field.field_id === 5,
    );
    expect(materialField.values).toEqual([
      { value: "ПГС", enum_id: 101 },
      { value: "Щебень", enum_id: 202 },
    ]);
  });

  it("shows an old unlinked warehouse lead instead of crashing the whole list", async () => {
    warehouse = {
      ...warehouse,
      custom_fields_values: [
        { field_id: 2, values: [{ value: "Старый объект" }] },
        { field_id: 5, values: [{ value: "Песок", enum_id: 303 }] },
      ],
    };
    const request = await getRequest(WAREHOUSE_ID, "Склад");
    expect(request.company).toBe("Старый объект");
    expect(request.materials).toEqual([{ enumId: 303, name: "Песок", sortOrder: 0 }]);
    expect(request.syncIssue).toContain("нет связи");
  });

  it("writes scalar fact and unit price only for one material", async () => {
    const items = mocks.state.draft!.items;
    await saveWarehouseRequest(WAREHOUSE_ID, completionInput(items), "Склад");
    const dispatchFields = mocks.updateLead.mock.calls.find(
      ([id, payload]) => id === DISPATCH_ID && payload.custom_fields_values,
    )?.[1].custom_fields_values;
    expect(dispatchFields.map((field: { field_id: number }) => field.field_id)).toEqual(
      expect.arrayContaining([4, 7, 8, 9, 10]),
    );
    expect(dispatchFields.map((field: { field_id: number }) => field.field_id)).not.toContain(3);
  });

  it("keeps multi-material details in SQLite and does not write misleading scalars", async () => {
    source = dispatchLead([
      { value: "ПГС", enum_id: 101 },
      { value: "Щебень", enum_id: 202 },
    ]);
    mocks.state.draft = draft([line(101, "ПГС", 0), line(202, "Щебень", 1)]);
    await saveWarehouseRequest(
      WAREHOUSE_ID,
      completionInput(mocks.state.draft.items),
      "Склад",
    );
    const dispatchFields = mocks.updateLead.mock.calls.find(
      ([id, payload]) => id === DISPATCH_ID && payload.custom_fields_values,
    )?.[1].custom_fields_values;
    const ids = dispatchFields.map((field: { field_id: number }) => field.field_id);
    expect(ids).toEqual(expect.arrayContaining([8, 9, 10]));
    expect(ids).not.toEqual(expect.arrayContaining([3, 4, 7]));
  });

  it("requires source fields and an invoice before completion", async () => {
    source = dispatchLead([{ value: "ПГС", enum_id: 101 }], "");
    await expect(
      saveWarehouseRequest(
        WAREHOUSE_ID,
        completionInput(mocks.state.draft!.items),
        "Склад",
      ),
    ).rejects.toThrow("В amoCRM не указан объект");

    source = dispatchLead();
    mocks.getLeadFileLinks.mockResolvedValue([]);
    await expect(
      saveWarehouseRequest(
        WAREHOUSE_ID,
        completionInput(mocks.state.draft!.items),
        "Склад",
      ),
    ).rejects.toThrow("добавьте хотя бы одну накладную");
  });

  it("keeps completing state after a partial amoCRM error and retries without resaving", async () => {
    let failWarehouseUpdate = true;
    mocks.updateLead.mockImplementation(async (id: number, payload: { status_id?: number }) => {
      if (id === WAREHOUSE_ID && payload.status_id && failWarehouseUpdate) {
        failWarehouseUpdate = false;
        throw new Error("temporary amoCRM failure");
      }
    });
    const firstInput = completionInput(mocks.state.draft!.items);
    await expect(saveWarehouseRequest(WAREHOUSE_ID, firstInput, "Склад")).rejects.toThrow(
      "temporary amoCRM failure",
    );
    expect(mocks.state.draft?.status).toBe("completing");
    expect(mocks.repository.markCompleted).not.toHaveBeenCalled();

    await saveWarehouseRequest(
      WAREHOUSE_ID,
      { ...firstInput, version: mocks.state.draft!.version },
      "Склад",
    );
    expect(mocks.repository.saveDraft).toHaveBeenCalledTimes(1);
    expect(mocks.repository.markCompleted).toHaveBeenCalledTimes(1);
  });

  it("surfaces completion validation errors", async () => {
    const bad = completionInput(mocks.state.draft!.items);
    bad.items[0].actualQuantity = "0";
    await expect(saveWarehouseRequest(WAREHOUSE_ID, bad, "Склад")).rejects.toBeInstanceOf(
      WarehouseValidationError,
    );
  });
});
