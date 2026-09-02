import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WarehouseRepository } from "../warehouse-db";
import {
  WarehouseConflictError,
  WarehouseLockedError,
  WarehouseValidationError,
  type SaveWarehouseRequestInput,
  type SourceMaterial,
} from "../warehouse-types";

const initialMaterials: SourceMaterial[] = [
  { enumId: 11, name: "ПГС", sortOrder: 0 },
  { enumId: 22, name: "Щебень", sortOrder: 1 },
];

function input(version: number): SaveWarehouseRequestInput {
  return {
    action: "draft",
    version,
    palletCount: 2,
    deliveryCost: "20.25",
    items: [
      { materialEnumId: 11, actualQuantity: "1.25", unit: "т", unitPrice: "100.10" },
      { materialEnumId: 22, actualQuantity: "3", unit: "кг", unitPrice: "0.20" },
    ],
  };
}

describe("WarehouseRepository", () => {
  let directory: string;
  let dbPath: string;
  let repository: WarehouseRepository;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "warehouse-test-"));
    dbPath = path.join(directory, "warehouse.sqlite");
    repository = new WarehouseRepository(dbPath);
  });

  afterEach(() => {
    repository.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("runs versioned migration and lazily creates a draft", () => {
    expect(repository.db.pragma("user_version", { simple: true })).toBe(3);
    const draft = repository.ensureDraft(100, 200, initialMaterials, "Тест");
    expect(draft.exists).toBe(true);
    expect(draft.status).toBe("draft");
    expect(draft.items.map((item) => item.materialName)).toEqual(["ПГС", "Щебень"]);
  });

  it("persists exact totals and survives reopening", () => {
    const created = repository.ensureDraft(100, 200, initialMaterials, "Тест");
    const saved = repository.saveDraft(100, created.version, input(created.version), "Тест", "draft");
    expect(saved.materialSubtotalMinor).toBe(12573);
    expect(saved.deliveryCostMinor).toBe(2025);
    expect(saved.totalMinor).toBe(14598);

    repository.close();
    repository = new WarehouseRepository(dbPath);
    expect(repository.getDraft(100)).toMatchObject({
      palletCount: 2,
      deliveryCost: "20.25",
      totalMinor: 14598,
    });
  });

  it("locally hides requests without deleting their amoCRM data", () => {
    expect(repository.hideRequests([100, 101, 100], "Администратор")).toBe(2);
    expect(repository.hiddenLeadIds()).toEqual(new Set([100, 101]));
    expect(repository.hideRequests([100], "Администратор")).toBe(0);

    repository.close();
    repository = new WarehouseRepository(dbPath);
    expect(repository.hiddenLeadIds()).toEqual(new Set([100, 101]));
  });

  it("upgrades an existing version 1 database through every migration", () => {
    repository.db.exec("DROP TABLE warehouse_request_files");
    repository.db.exec("DROP TABLE warehouse_hidden_requests");
    repository.db.pragma("user_version = 1");
    repository.close();
    repository = new WarehouseRepository(dbPath);

    expect(repository.db.pragma("user_version", { simple: true })).toBe(3);
    expect(repository.hideRequests([100], "Миграция")).toBe(1);
    expect(repository.hiddenLeadIds().has(100)).toBe(true);
  });

  it("keeps uploaded invoices visible while amoCRM indexes their link", () => {
    repository.rememberRequestFile({
      warehouseLeadId: 100,
      uuid: "11111111-1111-4111-8111-111111111111",
      versionUuid: "22222222-2222-4222-8222-222222222222",
      name: "накладная.jpg",
      size: 12345,
      mimeType: "image/jpeg",
      createdAt: "2026-09-02T10:00:00.000Z",
      downloadUrl: "https://drive.example/download/file.jpg",
      previewUrl: "https://drive.example/download/preview.jpg",
    });

    repository.close();
    repository = new WarehouseRepository(dbPath);
    expect(repository.requestFiles(100)).toEqual([
      expect.objectContaining({
        name: "накладная.jpg",
        mimeType: "image/jpeg",
        size: 12345,
      }),
    ]);
  });

  it("rejects a stale version", () => {
    const created = repository.ensureDraft(100, 200, initialMaterials, "Тест");
    repository.saveDraft(100, created.version, input(created.version), "Первый", "draft");
    expect(() =>
      repository.saveDraft(100, created.version, input(created.version), "Второй", "draft"),
    ).toThrow(WarehouseConflictError);
  });

  it("adds new materials, archives removed ones and preserves entered data", () => {
    const created = repository.ensureDraft(100, 200, initialMaterials, "Тест");
    const saved = repository.saveDraft(100, created.version, input(created.version), "Тест", "draft");
    const reconciled = repository.ensureDraft(
      100,
      200,
      [
        { enumId: 11, name: "ПГС обновлённый", sortOrder: 0 },
        { enumId: 33, name: "Песок", sortOrder: 1 },
      ],
      "Тест",
    );
    expect(reconciled.version).toBeGreaterThan(saved.version);
    expect(reconciled.items.find((item) => item.materialEnumId === 11)).toMatchObject({
      materialName: "ПГС обновлённый",
      actualQuantity: "1.25",
      sourceActive: true,
    });
    expect(reconciled.items.find((item) => item.materialEnumId === 22)?.sourceActive).toBe(false);
    expect(reconciled.items.find((item) => item.materialEnumId === 33)).toMatchObject({
      actualQuantity: null,
      sourceActive: true,
    });
  });

  it("freezes material composition and numerical changes after completion", () => {
    const created = repository.ensureDraft(100, 200, initialMaterials, "Тест");
    const saved = repository.saveDraft(100, created.version, input(created.version), "Тест", "completing");
    const completed = repository.markCompleted(100, "Тест");
    const frozen = repository.ensureDraft(
      100,
      200,
      [{ enumId: 99, name: "Новый", sortOrder: 0 }],
      "Тест",
    );
    expect(frozen.items.map((item) => item.materialEnumId)).toEqual(
      completed.items.map((item) => item.materialEnumId),
    );
    expect(() =>
      repository.saveDraft(100, saved.version, input(saved.version), "Тест", "draft"),
    ).toThrow(WarehouseLockedError);
  });

  it("validates pallets and custom unit length", () => {
    const created = repository.ensureDraft(100, 200, initialMaterials, "Тест");
    expect(() =>
      repository.saveDraft(
        100,
        created.version,
        { ...input(created.version), palletCount: 1.5 },
        "Тест",
        "draft",
      ),
    ).toThrow(WarehouseValidationError);
    expect(() =>
      repository.saveDraft(
        100,
        created.version,
        {
          ...input(created.version),
          items: input(created.version).items.map((item, index) =>
            index === 0 ? { ...item, unit: "x".repeat(31) } : item,
          ),
        },
        "Тест",
        "draft",
      ),
    ).toThrow(WarehouseValidationError);
  });
});
