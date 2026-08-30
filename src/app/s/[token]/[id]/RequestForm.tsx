"use client";

import { useActionState, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { saveRequestAction, type SaveState } from "./actions";
import { formatMoney } from "@/lib/format";

interface Props {
  token: string;
  id: number;
  initialQuantity: number | null;
  initialUnitPrice: number | null;
  initialDeliveryCost: number | null;
  isDone: boolean;
}

function SubmitButton({ isDone }: { isDone: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-lg bg-gray-900 py-3 font-medium text-white transition active:bg-gray-700 disabled:opacity-50"
    >
      {pending ? "Сохранение…" : isDone ? "Сохранить изменения" : "Сохранить и завершить"}
    </button>
  );
}

export function RequestForm({
  token,
  id,
  initialQuantity,
  initialUnitPrice,
  initialDeliveryCost,
  isDone,
}: Props) {
  const [state, formAction] = useActionState<SaveState, FormData>(saveRequestAction, {
    ok: false,
  });
  const [quantity, setQuantity] = useState(initialQuantity?.toString() ?? "");
  const [unitPrice, setUnitPrice] = useState(initialUnitPrice?.toString() ?? "");
  const [deliveryCost, setDeliveryCost] = useState(
    initialDeliveryCost?.toString() ?? "",
  );

  const budget = useMemo(() => {
    const q = Number(quantity) || 0;
    const p = Number(unitPrice) || 0;
    const d = Number(deliveryCost) || 0;
    if (!q || !p) return null;
    return q * p + d;
  }, [quantity, unitPrice, deliveryCost]);

  const field =
    "mt-1 w-full rounded-lg border border-gray-300 p-3 text-lg outline-none focus:border-gray-900";

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="id" value={id} />

      <label className="block">
        <span className="text-sm text-gray-500">Количество (факт), ед.</span>
        <input
          name="quantity"
          type="number"
          inputMode="decimal"
          step="any"
          min="0"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          className={field}
        />
      </label>

      <label className="block">
        <span className="text-sm text-gray-500">Цена за единицу, ₸</span>
        <input
          name="unitPrice"
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0"
          required
          value={unitPrice}
          onChange={(e) => setUnitPrice(e.target.value)}
          className={field}
        />
      </label>

      <label className="block">
        <span className="text-sm text-gray-500">Стоимость доставки, ₸</span>
        <input
          name="deliveryCost"
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0"
          required
          value={deliveryCost}
          onChange={(e) => setDeliveryCost(e.target.value)}
          className={field}
        />
      </label>

      <div className="rounded-lg bg-gray-100 p-4">
        <div className="text-sm text-gray-500">Бюджет отгрузки</div>
        <div className="text-2xl font-semibold">{formatMoney(budget)}</div>
        <div className="mt-1 text-xs text-gray-400">количество × цена + доставка</div>
      </div>

      {!isDone && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="markDone" defaultChecked className="h-4 w-4" />
          Перевести сделку на этап «Готово»
        </label>
      )}

      {state.error && (
        <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{state.error}</p>
      )}
      {state.ok && (
        <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">
          Сохранено в amoCRM
        </p>
      )}

      <SubmitButton isDone={isDone} />
    </form>
  );
}
