"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getUserByToken } from "@/lib/auth";
import { saveWarehouseRequest } from "@/lib/requests";
import {
  WarehouseConflictError,
  WarehouseLockedError,
  WarehouseValidationError,
} from "@/lib/warehouse-types";

const itemSchema = z.object({
  materialEnumId: z.number().int(),
  actualQuantity: z.string().nullable(),
  unit: z.string().nullable(),
  unitPrice: z.string().nullable(),
});

const schema = z.object({
  token: z.string().min(8),
  id: z.coerce.number().int().positive(),
  version: z.coerce.number().int().nonnegative(),
  action: z.enum(["draft", "complete"]),
  palletCount: z
    .string()
    .transform((value) => (value.trim() === "" ? null : Number(value)))
    .refine(
      (value) => value === null || (Number.isInteger(value) && value >= 0),
      "Количество поддонов должно быть целым неотрицательным числом",
    ),
  deliveryCost: z.string().transform((value) => value.trim() || null),
  items: z.array(itemSchema),
});

export interface SaveState {
  ok: boolean;
  error?: string;
  message?: string;
  conflict?: boolean;
}

function parseItems(value: FormDataEntryValue | null): unknown {
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function currentItems(formData: FormData): unknown {
  const fallback = parseItems(formData.get("itemsJson"));
  if (!Array.isArray(fallback)) return fallback;

  return fallback.map((raw) => {
    if (!raw || typeof raw !== "object" || !("materialEnumId" in raw)) return raw;
    const item = raw as {
      materialEnumId: unknown;
      actualQuantity?: unknown;
      unit?: unknown;
      unitPrice?: unknown;
    };
    const id = Number(item.materialEnumId);
    if (!Number.isInteger(id)) return raw;
    const prefix = `items.${id}`;
    const quantity = formData.get(`${prefix}.actualQuantity`);
    const unitChoice = formData.get(`${prefix}.unitChoice`);
    const customUnit = formData.get(`${prefix}.customUnit`);
    const price = formData.get(`${prefix}.unitPrice`);

    return {
      ...item,
      actualQuantity:
        typeof quantity === "string" ? quantity.trim() || null : item.actualQuantity,
      unit:
        typeof unitChoice === "string"
          ? (unitChoice === "__other__" && typeof customUnit === "string"
              ? customUnit
              : unitChoice
            ).trim() || null
          : item.unit,
      unitPrice: typeof price === "string" ? price.trim() || null : item.unitPrice,
    };
  });
}

export async function saveRequestAction(
  _previous: SaveState,
  formData: FormData,
): Promise<SaveState> {
  const parsed = schema.safeParse({
    token: formData.get("token"),
    id: formData.get("id"),
    version: formData.get("version"),
    action: formData.get("action"),
    palletCount: formData.get("palletCount") ?? "",
    deliveryCost: formData.get("deliveryCost") ?? "",
    items: currentItems(formData),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Проверьте поля" };
  }

  const user = getUserByToken(parsed.data.token);
  if (!user) return { ok: false, error: "Доступ запрещён" };

  try {
    await saveWarehouseRequest(
      parsed.data.id,
      {
        action: parsed.data.action,
        version: parsed.data.version,
        palletCount: parsed.data.palletCount,
        deliveryCost: parsed.data.deliveryCost,
        items: parsed.data.items,
      },
      user.name,
    );
  } catch (error) {
    console.error("saveRequestAction", error);
    if (error instanceof WarehouseConflictError) {
      return { ok: false, error: error.message, conflict: true };
    }
    if (
      error instanceof WarehouseValidationError ||
      error instanceof WarehouseLockedError
    ) {
      return { ok: false, error: error.message };
    }
    return {
      ok: false,
      error:
        parsed.data.action === "complete"
          ? "Не удалось передать данные в amoCRM. Черновик сохранён — повторите завершение."
          : "Не удалось сохранить черновик. Попробуйте ещё раз.",
    };
  }

  revalidatePath(`/s/${parsed.data.token}/${parsed.data.id}`);
  revalidatePath(`/s/${parsed.data.token}`);
  if (parsed.data.action === "complete") {
    redirect(`/s/${parsed.data.token}?completed=1`);
  }
  return {
    ok: true,
    message: "Черновик сохранён",
  };
}
