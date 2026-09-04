import "server-only";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { env } from "./env";
import {
  calculateTotals,
  decimalToMinor,
  lineAmountMinor,
  minorToDecimal,
  normalizeDecimal,
} from "./warehouse-calculations";
import {
  WarehouseConflictError,
  WarehouseLockedError,
  WarehouseValidationError,
  type SaveWarehouseRequestInput,
  type SourceMaterial,
  type WarehouseDraft,
  type WarehouseLineItem,
  type WarehouseRequestStatus,
} from "./warehouse-types";

interface RequestRow {
  warehouse_lead_id: number;
  dispatch_lead_id: number;
  status: WarehouseRequestStatus;
  pallet_count: number | null;
  delivery_cost_minor: number | null;
  material_subtotal_minor: number;
  total_minor: number;
  version: number;
  updated_by: string | null;
  updated_at: string;
  completed_by: string | null;
  completed_at: string | null;
}

interface ItemRow {
  id: number;
  warehouse_lead_id: number;
  material_enum_id: number;
  material_name: string;
  sort_order: number;
  source_active: number;
  unit: string | null;
  actual_quantity: string | null;
  unit_price_minor: number | null;
}

interface FileRow {
  warehouse_lead_id: number;
  file_uuid: string;
  version_uuid: string | null;
  name: string;
  size: number;
  mime_type: string;
  created_at: string;
  download_url: string | null;
  preview_url: string | null;
}

export interface StoredWarehouseFile {
  warehouseLeadId: number;
  uuid: string;
  versionUuid: string | null;
  name: string;
  size: number;
  mimeType: string;
  createdAt: string;
  downloadUrl: string | null;
  previewUrl: string | null;
}

function now(): string {
  return new Date().toISOString();
}

function resolveDbPath(rawPath: string): string {
  return path.isAbsolute(rawPath)
    ? rawPath
    : path.resolve(/* turbopackIgnore: true */ process.cwd(), rawPath);
}

function openDatabase(filePath: string): Database.Database {
  const resolved = resolveDbPath(filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const db = new Database(resolved);
  db.pragma("foreign_keys = ON");
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  migrate(db);
  return db;
}

function migrate(db: Database.Database): void {
  let version = db.pragma("user_version", { simple: true }) as number;

  if (version < 1) {
    db.transaction(() => {
      db.exec(`
      CREATE TABLE warehouse_requests (
        warehouse_lead_id INTEGER PRIMARY KEY,
        dispatch_lead_id INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft'
          CHECK (status IN ('draft', 'completing', 'completed')),
        pallet_count INTEGER,
        delivery_cost_minor INTEGER,
        material_subtotal_minor INTEGER NOT NULL DEFAULT 0,
        total_minor INTEGER NOT NULL DEFAULT 0,
        version INTEGER NOT NULL DEFAULT 1,
        created_by TEXT,
        updated_by TEXT,
        completed_by TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT
      );

      CREATE TABLE warehouse_request_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        warehouse_lead_id INTEGER NOT NULL,
        material_enum_id INTEGER NOT NULL,
        material_name TEXT NOT NULL,
        sort_order INTEGER NOT NULL,
        source_active INTEGER NOT NULL DEFAULT 1 CHECK (source_active IN (0, 1)),
        unit TEXT,
        actual_quantity TEXT,
        unit_price_minor INTEGER,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (warehouse_lead_id, material_enum_id),
        FOREIGN KEY (warehouse_lead_id) REFERENCES warehouse_requests(warehouse_lead_id)
          ON DELETE CASCADE
      );

      CREATE INDEX idx_warehouse_request_items_active
        ON warehouse_request_items(warehouse_lead_id, source_active, sort_order);

      CREATE TABLE warehouse_request_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        warehouse_lead_id INTEGER NOT NULL,
        version INTEGER NOT NULL,
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (warehouse_lead_id) REFERENCES warehouse_requests(warehouse_lead_id)
          ON DELETE CASCADE
      );
    `);
      db.pragma("user_version = 1");
    })();
    version = 1;
  }

  if (version < 2) {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE warehouse_hidden_requests (
          warehouse_lead_id INTEGER PRIMARY KEY,
          hidden_by TEXT NOT NULL,
          hidden_at TEXT NOT NULL
        );
      `);
      db.pragma("user_version = 2");
    })();
    version = 2;
  }

  if (version < 3) {
    db.transaction(() => {
      // Локальный индекс нужен потому, что amoCRM привязывает и индексирует
      // новый файл асинхронно. Без него накладная может исчезать из интерфейса
      // на несколько секунд сразу после успешной загрузки.
      db.exec(`
        CREATE TABLE warehouse_request_files (
          warehouse_lead_id INTEGER NOT NULL,
          file_uuid TEXT NOT NULL,
          version_uuid TEXT,
          name TEXT NOT NULL,
          size INTEGER NOT NULL,
          mime_type TEXT NOT NULL,
          created_at TEXT NOT NULL,
          download_url TEXT,
          preview_url TEXT,
          cached_at TEXT NOT NULL,
          PRIMARY KEY (warehouse_lead_id, file_uuid)
        );

        CREATE INDEX idx_warehouse_request_files_created
          ON warehouse_request_files(warehouse_lead_id, created_at DESC);
      `);
      db.pragma("user_version = 3");
    })();
  }
}

function fileFromRow(row: FileRow): StoredWarehouseFile {
  return {
    warehouseLeadId: row.warehouse_lead_id,
    uuid: row.file_uuid,
    versionUuid: row.version_uuid,
    name: row.name,
    size: row.size,
    mimeType: row.mime_type,
    createdAt: row.created_at,
    downloadUrl: row.download_url,
    previewUrl: row.preview_url,
  };
}

function itemFromRow(row: ItemRow): WarehouseLineItem {
  return {
    id: row.id,
    materialEnumId: row.material_enum_id,
    materialName: row.material_name,
    sortOrder: row.sort_order,
    sourceActive: row.source_active === 1,
    unit: row.unit,
    actualQuantity: row.actual_quantity,
    unitPriceMinor: row.unit_price_minor,
    unitPrice: minorToDecimal(row.unit_price_minor),
    amountMinor: lineAmountMinor(row.actual_quantity, row.unit_price_minor),
  };
}

export class WarehouseRepository {
  readonly db: Database.Database;

  constructor(filePath: string) {
    this.db = openDatabase(filePath);
  }

  close(): void {
    this.db.close();
  }

  requestFiles(warehouseLeadId: number): StoredWarehouseFile[] {
    return (
      this.db
        .prepare(
          `SELECT warehouse_lead_id, file_uuid, version_uuid, name, size,
                  mime_type, created_at, download_url, preview_url
           FROM warehouse_request_files
           WHERE warehouse_lead_id = ?
           ORDER BY created_at DESC, file_uuid ASC`,
        )
        .all(warehouseLeadId) as FileRow[]
    ).map(fileFromRow);
  }

  rememberRequestFile(file: StoredWarehouseFile): void {
    this.db
      .prepare(
        `INSERT INTO warehouse_request_files
          (warehouse_lead_id, file_uuid, version_uuid, name, size, mime_type,
           created_at, download_url, preview_url, cached_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(warehouse_lead_id, file_uuid) DO UPDATE SET
           version_uuid = excluded.version_uuid,
           name = excluded.name,
           size = excluded.size,
           mime_type = excluded.mime_type,
           created_at = excluded.created_at,
           download_url = COALESCE(excluded.download_url, warehouse_request_files.download_url),
           preview_url = COALESCE(excluded.preview_url, warehouse_request_files.preview_url),
           cached_at = excluded.cached_at`,
      )
      .run(
        file.warehouseLeadId,
        file.uuid,
        file.versionUuid,
        file.name,
        file.size,
        file.mimeType,
        file.createdAt,
        file.downloadUrl,
        file.previewUrl,
        now(),
      );
  }

  forgetRequestFile(warehouseLeadId: number, uuid: string): void {
    this.db
      .prepare(
        `DELETE FROM warehouse_request_files
         WHERE warehouse_lead_id = ? AND file_uuid = ?`,
      )
      .run(warehouseLeadId, uuid);
  }

  hiddenLeadIds(): Set<number> {
    const rows = this.db
      .prepare("SELECT warehouse_lead_id FROM warehouse_hidden_requests")
      .all() as Array<{ warehouse_lead_id: number }>;
    return new Set(rows.map((row) => row.warehouse_lead_id));
  }

  hasDispatchLead(dispatchLeadId: number): boolean {
    if (!Number.isInteger(dispatchLeadId) || dispatchLeadId <= 0) return false;
    const row = this.db
      .prepare(
        "SELECT 1 AS ok FROM warehouse_requests WHERE dispatch_lead_id = ? LIMIT 1",
      )
      .get(dispatchLeadId) as { ok: number } | undefined;
    return Boolean(row);
  }

  hideRequests(warehouseLeadIds: number[], actor: string): number {
    const ids = [...new Set(warehouseLeadIds)].filter(
      (id) => Number.isInteger(id) && id > 0,
    );
    if (!ids.length) return 0;
    const insert = this.db.prepare(
      `INSERT INTO warehouse_hidden_requests
        (warehouse_lead_id, hidden_by, hidden_at)
       VALUES (?, ?, ?)
       ON CONFLICT(warehouse_lead_id) DO NOTHING`,
    );
    return this.db.transaction(() => {
      let changes = 0;
      const timestamp = now();
      for (const id of ids) changes += insert.run(id, actor, timestamp).changes;
      return changes;
    })();
  }

  private requestRow(warehouseLeadId: number): RequestRow | undefined {
    return this.db
      .prepare("SELECT * FROM warehouse_requests WHERE warehouse_lead_id = ?")
      .get(warehouseLeadId) as RequestRow | undefined;
  }

  private itemRows(warehouseLeadId: number): ItemRow[] {
    return this.db
      .prepare(
        `SELECT * FROM warehouse_request_items
         WHERE warehouse_lead_id = ?
         ORDER BY source_active DESC, sort_order ASC, id ASC`,
      )
      .all(warehouseLeadId) as ItemRow[];
  }

  private audit(
    warehouseLeadId: number,
    version: number,
    actor: string,
    action: string,
    payload: unknown,
  ): void {
    this.db
      .prepare(
        `INSERT INTO warehouse_request_audit
          (warehouse_lead_id, version, actor, action, payload_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(warehouseLeadId, version, actor, action, JSON.stringify(payload), now());
  }

  ensureDraft(
    warehouseLeadId: number,
    dispatchLeadId: number,
    materials: SourceMaterial[],
    actor: string,
  ): WarehouseDraft {
    this.db.transaction(() => {
      const timestamp = now();
      let request = this.requestRow(warehouseLeadId);
      if (!request) {
        this.db
          .prepare(
            `INSERT INTO warehouse_requests
              (warehouse_lead_id, dispatch_lead_id, status, version,
               created_by, updated_by, created_at, updated_at)
             VALUES (?, ?, 'draft', 1, ?, ?, ?, ?)`,
          )
          .run(warehouseLeadId, dispatchLeadId, actor, actor, timestamp, timestamp);
        request = this.requestRow(warehouseLeadId);
      }
      if (!request) throw new Error("Не удалось создать локальный черновик");
      if (request.dispatch_lead_id !== dispatchLeadId) {
        throw new Error("Складская заявка связана с другой сделкой диспетчера");
      }
      if (request.status !== "draft") return;

      const existing = new Map(
        this.itemRows(warehouseLeadId).map((item) => [item.material_enum_id, item]),
      );
      const activeIds = new Set(materials.map((material) => material.enumId));
      let changed = false;

      const insert = this.db.prepare(
        `INSERT INTO warehouse_request_items
          (warehouse_lead_id, material_enum_id, material_name, sort_order,
           source_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)`,
      );
      const update = this.db.prepare(
        `UPDATE warehouse_request_items
         SET material_name = ?, sort_order = ?, source_active = 1, updated_at = ?
         WHERE warehouse_lead_id = ? AND material_enum_id = ?`,
      );
      for (const material of materials) {
        const current = existing.get(material.enumId);
        if (!current) {
          insert.run(
            warehouseLeadId,
            material.enumId,
            material.name,
            material.sortOrder,
            timestamp,
            timestamp,
          );
          changed = true;
          continue;
        }
        if (
          current.material_name !== material.name ||
          current.sort_order !== material.sortOrder ||
          current.source_active !== 1
        ) {
          update.run(
            material.name,
            material.sortOrder,
            timestamp,
            warehouseLeadId,
            material.enumId,
          );
          changed = true;
        }
      }

      for (const current of existing.values()) {
        if (current.source_active === 1 && !activeIds.has(current.material_enum_id)) {
          this.db
            .prepare(
              `UPDATE warehouse_request_items
               SET source_active = 0, updated_at = ?
               WHERE warehouse_lead_id = ? AND material_enum_id = ?`,
            )
            .run(timestamp, warehouseLeadId, current.material_enum_id);
          changed = true;
        }
      }

      if (changed) {
        const nextVersion = request.version + 1;
        this.db
          .prepare(
            `UPDATE warehouse_requests
             SET version = ?, updated_by = ?, updated_at = ?
             WHERE warehouse_lead_id = ?`,
          )
          .run(nextVersion, actor, timestamp, warehouseLeadId);
        this.audit(warehouseLeadId, nextVersion, actor, "materials_synced", materials);
      }
    })();

    return this.getDraft(warehouseLeadId);
  }

  getDraft(warehouseLeadId: number): WarehouseDraft {
    const request = this.requestRow(warehouseLeadId);
    if (!request) {
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
        items: [],
        updatedBy: null,
        updatedAt: null,
        completedBy: null,
        completedAt: null,
      };
    }

    return {
      exists: true,
      legacy: false,
      status: request.status,
      version: request.version,
      palletCount: request.pallet_count,
      deliveryCost: minorToDecimal(request.delivery_cost_minor),
      deliveryCostMinor: request.delivery_cost_minor,
      materialSubtotalMinor: request.material_subtotal_minor,
      totalMinor: request.total_minor,
      items: this.itemRows(warehouseLeadId).map(itemFromRow),
      updatedBy: request.updated_by,
      updatedAt: request.updated_at,
      completedBy: request.completed_by,
      completedAt: request.completed_at,
    };
  }

  saveDraft(
    warehouseLeadId: number,
    expectedVersion: number,
    input: SaveWarehouseRequestInput,
    actor: string,
    nextStatus: "draft" | "completing",
  ): WarehouseDraft {
    if (
      input.palletCount !== null &&
      (!Number.isInteger(input.palletCount) || input.palletCount < 0)
    ) {
      throw new WarehouseValidationError(
        "Количество поддонов должно быть целым неотрицательным числом",
      );
    }
    this.db.transaction(() => {
      const request = this.requestRow(warehouseLeadId);
      if (!request) throw new Error("Локальный черновик не найден");
      if (request.status === "completed") throw new WarehouseLockedError();
      if (request.status === "completing") {
        if (nextStatus === "completing") return;
        throw new WarehouseLockedError();
      }
      if (request.version !== expectedVersion) throw new WarehouseConflictError();

      const activeRows = this.itemRows(warehouseLeadId).filter(
        (item) => item.source_active === 1,
      );
      const supplied = new Map(input.items.map((item) => [item.materialEnumId, item]));
      if (
        supplied.size !== activeRows.length ||
        activeRows.some((row) => !supplied.has(row.material_enum_id))
      ) {
        throw new WarehouseConflictError();
      }

      const normalizedItems = activeRows.map((row) => {
        const item = supplied.get(row.material_enum_id);
        if (!item) throw new WarehouseConflictError();
        const actualQuantity = normalizeDecimal(item.actualQuantity, {
          allowNull: true,
          label: row.material_name,
        });
        const unitPrice = normalizeDecimal(item.unitPrice, {
          allowNull: true,
          label: `Цена «${row.material_name}»`,
        });
        const unit = item.unit?.trim() || null;
        if (unit && unit.length > 30) {
          throw new WarehouseValidationError(
            `Единица измерения слишком длинная: ${row.material_name}`,
          );
        }
        return {
          ...item,
          actualQuantity,
          unit,
          unitPrice,
        };
      });
      const deliveryCost = normalizeDecimal(input.deliveryCost, {
        allowNull: true,
        label: "Стоимость доставки",
      });
      const totals = calculateTotals(normalizedItems, deliveryCost);
      const timestamp = now();
      const updateItem = this.db.prepare(
        `UPDATE warehouse_request_items
         SET actual_quantity = ?, unit = ?, unit_price_minor = ?, updated_at = ?
         WHERE warehouse_lead_id = ? AND material_enum_id = ? AND source_active = 1`,
      );
      for (const item of normalizedItems) {
        updateItem.run(
          item.actualQuantity,
          item.unit,
          item.unitPrice === null ? null : decimalToMinor(item.unitPrice),
          timestamp,
          warehouseLeadId,
          item.materialEnumId,
        );
      }

      const nextVersion = request.version + 1;
      this.db
        .prepare(
          `UPDATE warehouse_requests
           SET status = ?, pallet_count = ?, delivery_cost_minor = ?,
               material_subtotal_minor = ?, total_minor = ?, version = ?,
               updated_by = ?, updated_at = ?
           WHERE warehouse_lead_id = ?`,
        )
        .run(
          nextStatus,
          input.palletCount,
          totals.deliveryCostMinor,
          totals.materialSubtotalMinor,
          totals.totalMinor,
          nextVersion,
          actor,
          timestamp,
          warehouseLeadId,
        );
      this.audit(warehouseLeadId, nextVersion, actor, nextStatus, {
        palletCount: input.palletCount,
        deliveryCost,
        items: normalizedItems,
      });
    })();

    return this.getDraft(warehouseLeadId);
  }

  markCompleted(warehouseLeadId: number, actor: string): WarehouseDraft {
    this.db.transaction(() => {
      const request = this.requestRow(warehouseLeadId);
      if (!request) throw new Error("Локальный черновик не найден");
      if (request.status === "completed") return;
      const timestamp = now();
      const nextVersion = request.version + 1;
      this.db
        .prepare(
          `UPDATE warehouse_requests
           SET status = 'completed', version = ?, updated_by = ?, updated_at = ?,
               completed_by = ?, completed_at = ?
           WHERE warehouse_lead_id = ?`,
        )
        .run(nextVersion, actor, timestamp, actor, timestamp, warehouseLeadId);
      this.audit(warehouseLeadId, nextVersion, actor, "completed", {});
    })();
    return this.getDraft(warehouseLeadId);
  }
}

let singleton: WarehouseRepository | null = null;

export function getWarehouseRepository(): WarehouseRepository {
  singleton ??= new WarehouseRepository(env.warehouseDbPath);
  return singleton;
}

export function legacyDraft(materials: SourceMaterial[]): WarehouseDraft {
  return {
    exists: false,
    legacy: true,
    status: "completed",
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
