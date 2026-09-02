import Decimal from "decimal.js";
import {
  WarehouseValidationError,
  type WarehouseLineItemInput,
} from "./warehouse-types";

const MONEY_FACTOR = new Decimal(100);
const DECIMAL_RE = /^\d+(?:[.,]\d+)?$/;

export function normalizeDecimal(
  value: string | number | null | undefined,
  options: { allowNull?: boolean; label?: string } = {},
): string | null {
  const label = options.label ?? "Значение";
  if (value === null || value === undefined || String(value).trim() === "") {
    if (options.allowNull !== false) return null;
    throw new WarehouseValidationError(`${label}: поле обязательно`);
  }

  // Пользователи часто вводят цены как «15 000» или «15 000,50».
  // Пробелы здесь являются только разделителями разрядов.
  const raw = String(value).trim().replace(/[\s\u00a0\u202f]/g, "");
  if (!DECIMAL_RE.test(raw)) {
    throw new WarehouseValidationError(`${label}: укажите неотрицательное число`);
  }

  const decimal = new Decimal(raw.replace(",", "."));
  if (!decimal.isFinite() || decimal.isNegative()) {
    throw new WarehouseValidationError(`${label}: укажите неотрицательное число`);
  }

  return decimal.toFixed().replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

export function decimalToMinor(value: string | number): number {
  const minor = new Decimal(value)
    .mul(MONEY_FACTOR)
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  if (!minor.isInteger() || minor.abs().greaterThan(Number.MAX_SAFE_INTEGER)) {
    throw new WarehouseValidationError("Сумма слишком большая");
  }
  return minor.toNumber();
}

export function minorToDecimal(value: number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return new Decimal(value)
    .div(MONEY_FACTOR)
    .toFixed(2)
    .replace(/\.00$/, "")
    .replace(/(\.\d)0$/, "$1");
}

export function lineAmountMinor(
  actualQuantity: string | null,
  unitPriceMinor: number | null,
): number | null {
  if (actualQuantity === null || unitPriceMinor === null) return null;
  const amount = new Decimal(actualQuantity)
    .mul(unitPriceMinor)
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  if (amount.abs().greaterThan(Number.MAX_SAFE_INTEGER)) {
    throw new WarehouseValidationError("Сумма позиции слишком большая");
  }
  return amount.toNumber();
}

export function calculateTotals(
  items: Array<Pick<WarehouseLineItemInput, "actualQuantity" | "unitPrice">>,
  deliveryCost: string | null,
): {
  materialSubtotalMinor: number;
  deliveryCostMinor: number | null;
  totalMinor: number;
} {
  let subtotal = new Decimal(0);
  for (const item of items) {
    const quantity = normalizeDecimal(item.actualQuantity, { allowNull: true });
    const price = normalizeDecimal(item.unitPrice, { allowNull: true });
    if (quantity === null || price === null) continue;
    subtotal = subtotal.add(new Decimal(quantity).mul(decimalToMinor(price)));
  }

  const roundedSubtotal = subtotal.toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  if (roundedSubtotal.abs().greaterThan(Number.MAX_SAFE_INTEGER)) {
    throw new WarehouseValidationError("Итоговая сумма слишком большая");
  }
  const materialSubtotalMinor = roundedSubtotal.toNumber();
  const normalizedDelivery = normalizeDecimal(deliveryCost, { allowNull: true });
  const deliveryCostMinor =
    normalizedDelivery === null ? null : decimalToMinor(normalizedDelivery);

  return {
    materialSubtotalMinor,
    deliveryCostMinor,
    totalMinor: materialSubtotalMinor + (deliveryCostMinor ?? 0),
  };
}

export function hasPositiveActualQuantity(items: WarehouseLineItemInput[]): boolean {
  return items.some((item) => {
    const value = normalizeDecimal(item.actualQuantity, { allowNull: true });
    return value !== null && new Decimal(value).greaterThan(0);
  });
}

export function isPositiveDecimal(value: string | number | null | undefined): boolean {
  const normalized = normalizeDecimal(value, { allowNull: true });
  return normalized !== null && new Decimal(normalized).greaterThan(0);
}
