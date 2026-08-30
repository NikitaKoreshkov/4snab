"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getUserByToken } from "@/lib/auth";
import { saveRequest } from "@/lib/requests";

const schema = z.object({
  token: z.string().min(8),
  id: z.coerce.number().int().positive(),
  quantity: z
    .string()
    .optional()
    .transform((v) => (v && v.trim() !== "" ? Number(v) : null))
    .refine((v) => v === null || (Number.isFinite(v) && v >= 0), "Некорректное количество"),
  unitPrice: z.coerce.number().min(0),
  deliveryCost: z.coerce.number().min(0),
  markDone: z
    .union([z.literal("on"), z.literal("true"), z.literal("")])
    .optional()
    .transform((v) => v === "on" || v === "true"),
});

export interface SaveState {
  ok: boolean;
  error?: string;
}

export async function saveRequestAction(
  _prev: SaveState,
  formData: FormData,
): Promise<SaveState> {
  const parsed = schema.safeParse({
    token: formData.get("token"),
    id: formData.get("id"),
    quantity: formData.get("quantity") ?? "",
    unitPrice: formData.get("unitPrice"),
    deliveryCost: formData.get("deliveryCost"),
    markDone: formData.get("markDone") ?? "",
  });

  if (!parsed.success) {
    return { ok: false, error: "Проверьте правильность заполнения полей" };
  }

  const { token, id, quantity, unitPrice, deliveryCost, markDone } = parsed.data;
  if (!getUserByToken(token)) {
    return { ok: false, error: "Доступ запрещён" };
  }

  try {
    await saveRequest(id, { quantity, unitPrice, deliveryCost, markDone });
  } catch (err) {
    console.error("saveRequestAction", err);
    return { ok: false, error: "Не удалось сохранить в amoCRM. Попробуйте ещё раз." };
  }

  revalidatePath(`/s/${token}/${id}`);
  revalidatePath(`/s/${token}`);
  return { ok: true };
}
