"use client";

import { useActionState, useMemo, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { formatMoney } from "@/lib/format";
import {
  WAREHOUSE_UNITS,
  type WarehouseDraft,
  type WarehouseSaveAction,
} from "@/lib/warehouse-types";
import { saveRequestAction, type SaveState } from "./actions";

interface Props {
  token: string;
  id: number;
  draft: WarehouseDraft;
  isDone: boolean;
  blockedReason?: string | null;
}

interface EditableLine {
  materialEnumId: number;
  materialName: string;
  actualQuantity: string;
  unitChoice: string;
  customUnit: string;
  unitPrice: string;
}

const OTHER_UNIT = "__other__";
const fieldClass =
  "mt-1 w-full rounded-lg border border-gray-300 bg-white p-3 text-base outline-none focus:border-gray-900 disabled:bg-gray-100 disabled:text-gray-500";

function decimalNumber(value: string): number {
  const parsed = Number(value.replace(/[\s\u00a0\u202f]/g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function initialLine(
  item: WarehouseDraft["items"][number],
): EditableLine {
  const knownUnit = WAREHOUSE_UNITS.some((unit) => unit === item.unit);
  return {
    materialEnumId: item.materialEnumId,
    materialName: item.materialName,
    actualQuantity: item.actualQuantity ?? "",
    unitChoice: item.unit ? (knownUnit ? item.unit : OTHER_UNIT) : "",
    customUnit: item.unit && !knownUnit ? item.unit : "",
    unitPrice: item.unitPrice ?? "",
  };
}

function ActionButton({
  action,
  children,
  secondary = false,
}: {
  action: WarehouseSaveAction;
  children: string;
  secondary?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name="action"
      value={action}
      disabled={pending}
      className={
        secondary
          ? "w-full rounded-lg border border-gray-300 bg-white px-4 py-3 font-medium transition hover:bg-gray-50 disabled:opacity-50"
          : "w-full rounded-lg bg-gray-900 px-4 py-3 font-medium text-white transition hover:bg-gray-800 disabled:opacity-50"
      }
    >
      {pending ? "Сохранение…" : children}
    </button>
  );
}

export function RequestForm({ token, id, draft, isDone, blockedReason }: Props) {
  const [state, formAction] = useActionState<SaveState, FormData>(saveRequestAction, {
    ok: false,
  });
  const [lines, setLines] = useState<EditableLine[]>(() =>
    draft.items.filter((item) => item.sourceActive).map(initialLine),
  );
  const [palletCount, setPalletCount] = useState(draft.palletCount?.toString() ?? "");
  const [deliveryCost, setDeliveryCost] = useState(draft.deliveryCost ?? "");
  const itemsJsonRef = useRef<HTMLInputElement>(null);
  const locked = Boolean(blockedReason) || isDone || draft.legacy || draft.status !== "draft";

  const itemsJson = useMemo(
    () =>
      JSON.stringify(
        lines.map((line) => ({
          materialEnumId: line.materialEnumId,
          actualQuantity: line.actualQuantity.trim() || null,
          unit:
            (line.unitChoice === OTHER_UNIT ? line.customUnit : line.unitChoice).trim() ||
            null,
          unitPrice: line.unitPrice.trim() || null,
        })),
      ),
    [lines],
  );
  const materialSubtotal = useMemo(
    () =>
      lines.reduce(
        (sum, line) =>
          sum + decimalNumber(line.actualQuantity) * decimalNumber(line.unitPrice),
        0,
      ),
    [lines],
  );
  const total = materialSubtotal + decimalNumber(deliveryCost);

  function updateLine(index: number, patch: Partial<EditableLine>) {
    setLines((current) =>
      current.map((line, lineIndex) =>
        lineIndex === index ? { ...line, ...patch } : line,
      ),
    );
  }

  function syncSubmittedItems() {
    // Обновляем значение непосредственно в момент submit: быстрый ввод цены
    // и немедленный клик не смогут отправить предыдущий React-render.
    if (itemsJsonRef.current) itemsJsonRef.current.value = itemsJson;
  }

  if (draft.legacy) {
    return (
      <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        Эта заявка была завершена до появления построчного складского учёта. Материалы
        показаны из amoCRM, но неизвестные старые цены и количества не восстанавливаются.
      </section>
    );
  }

  return (
    <form action={formAction} onSubmit={syncSubmittedItems} className="space-y-5">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="version" value={draft.version} />
      <input ref={itemsJsonRef} type="hidden" name="itemsJson" value={itemsJson} />

      <section>
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <h2 className="font-semibold">Материалы</h2>
            <p className="text-xs text-gray-500">Фактические данные склада</p>
          </div>
          <span className="text-xs text-gray-400">{lines.length} поз.</span>
        </div>

        <div className="space-y-3">
          {lines.map((line, index) => {
            const amount =
              decimalNumber(line.actualQuantity) * decimalNumber(line.unitPrice);
            return (
              <article key={line.materialEnumId} className="rounded-xl border p-4">
                <h3 className="mb-3 font-medium">{line.materialName}</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="text-sm text-gray-500">Фактическое количество</span>
                    <input
                      name={`items.${line.materialEnumId}.actualQuantity`}
                      type="text"
                      inputMode="decimal"
                      disabled={locked}
                      value={line.actualQuantity}
                      onChange={(event) =>
                        updateLine(index, { actualQuantity: event.target.value })
                      }
                      className={fieldClass}
                      placeholder="0"
                    />
                  </label>
                  <label className="block">
                    <span className="text-sm text-gray-500">Единица</span>
                    <select
                      name={`items.${line.materialEnumId}.unitChoice`}
                      disabled={locked}
                      value={line.unitChoice}
                      onChange={(event) =>
                        updateLine(index, { unitChoice: event.target.value })
                      }
                      className={fieldClass}
                    >
                      <option value="">Выберите</option>
                      {WAREHOUSE_UNITS.map((unit) => (
                        <option key={unit} value={unit}>
                          {unit}
                        </option>
                      ))}
                      <option value={OTHER_UNIT}>Другое</option>
                    </select>
                  </label>
                </div>
                {line.unitChoice === OTHER_UNIT && (
                  <label className="mt-3 block">
                    <span className="text-sm text-gray-500">Своя единица измерения</span>
                    <input
                      name={`items.${line.materialEnumId}.customUnit`}
                      type="text"
                      maxLength={30}
                      disabled={locked}
                      value={line.customUnit}
                      onChange={(event) =>
                        updateLine(index, { customUnit: event.target.value })
                      }
                      className={fieldClass}
                      placeholder="Например, машина"
                    />
                  </label>
                )}
                <div className="mt-3 grid items-end gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="text-sm text-gray-500">Цена за единицу, ₸</span>
                    <input
                      name={`items.${line.materialEnumId}.unitPrice`}
                      type="text"
                      inputMode="decimal"
                      disabled={locked}
                      value={line.unitPrice}
                      onChange={(event) =>
                        updateLine(index, { unitPrice: event.target.value })
                      }
                      className={fieldClass}
                      placeholder="0"
                    />
                  </label>
                  <div className="rounded-lg bg-gray-50 px-3 py-3">
                    <div className="text-xs text-gray-500">Сумма позиции</div>
                    <div className="font-semibold">{formatMoney(amount)}</div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {draft.items.some((item) => !item.sourceActive) && (
        <details className="rounded-lg border border-dashed p-3 text-sm text-gray-500">
          <summary className="cursor-pointer">
            Удалённые из amoCRM материалы (
            {draft.items.filter((item) => !item.sourceActive).length})
          </summary>
          <ul className="mt-2 list-disc pl-5">
            {draft.items
              .filter((item) => !item.sourceActive)
              .map((item) => (
                <li key={item.materialEnumId}>{item.materialName}</li>
              ))}
          </ul>
        </details>
      )}

      <section className="grid gap-4 rounded-xl border p-4 sm:grid-cols-2">
        <label className="block">
          <span className="text-sm text-gray-500">Количество поддонов, шт.</span>
          <input
            name="palletCount"
            type="number"
            inputMode="numeric"
            step="1"
            min="0"
            disabled={locked}
            value={palletCount}
            onChange={(event) => setPalletCount(event.target.value)}
            className={fieldClass}
            placeholder="0"
          />
          <span className="mt-1 block text-xs text-gray-400">
            Если поддонов нет — укажите 0
          </span>
        </label>
        <label className="block">
          <span className="text-sm text-gray-500">Стоимость доставки, ₸</span>
          <input
            name="deliveryCost"
            type="text"
            inputMode="decimal"
            disabled={locked}
            value={deliveryCost}
            onChange={(event) => setDeliveryCost(event.target.value)}
            className={fieldClass}
            placeholder="0"
          />
        </label>
      </section>

      <section className="rounded-xl bg-gray-100 p-4">
        <div className="flex justify-between gap-4 text-sm text-gray-600">
          <span>Материалы</span>
          <span>{formatMoney(materialSubtotal)}</span>
        </div>
        <div className="mt-1 flex justify-between gap-4 text-sm text-gray-600">
          <span>Доставка</span>
          <span>{formatMoney(decimalNumber(deliveryCost))}</span>
        </div>
        <div className="mt-3 flex justify-between gap-4 border-t border-gray-300 pt-3">
          <span className="font-medium">Общий итог</span>
          <span className="text-xl font-semibold">{formatMoney(total)}</span>
        </div>
      </section>

      {draft.status === "completing" && (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          Черновик сохранён. Передача в amoCRM завершилась не полностью — числовые данные
          заблокированы, повторите синхронизацию.
        </p>
      )}
      {blockedReason && (
        <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {blockedReason}
        </p>
      )}
      {state.error && (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          <p>{state.error}</p>
          {state.conflict && (
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-2 font-medium underline"
            >
              Перезагрузить данные
            </button>
          )}
        </div>
      )}
      {state.ok && (
        <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">
          {state.message}
        </p>
      )}

      {!blockedReason && !isDone && draft.status === "draft" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <ActionButton action="draft" secondary>
            Сохранить черновик
          </ActionButton>
          <ActionButton action="complete">Завершить и передать диспетчеру</ActionButton>
        </div>
      )}
      {!blockedReason && !isDone && draft.status === "completing" && (
        <ActionButton action="complete">Повторить передачу в amoCRM</ActionButton>
      )}
      {isDone && (
        <p className="text-center text-sm text-gray-500">
          Заявка завершена. Числовые данные заблокированы; новые накладные можно добавлять
          выше.
        </p>
      )}
    </form>
  );
}
