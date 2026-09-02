import { describe, expect, it } from "vitest";
import {
  calculateTotals,
  decimalToMinor,
  hasPositiveActualQuantity,
  minorToDecimal,
  normalizeDecimal,
} from "../warehouse-calculations";
import { WarehouseValidationError } from "../warehouse-types";

describe("warehouse calculations", () => {
  it("normalizes comma decimals without binary floating point drift", () => {
    expect(normalizeDecimal("001,2500")).toBe("1.25");
    expect(normalizeDecimal("100 000,50")).toBe("100000.5");
    expect(normalizeDecimal("15 000,25")).toBe("15000.25");
    expect(decimalToMinor("100.105")).toBe(10011);
    expect(minorToDecimal(10011)).toBe("100.11");
  });

  it("calculates every line, material subtotal and delivery", () => {
    expect(
      calculateTotals(
        [
          { actualQuantity: "1.25", unitPrice: "100.10" },
          { actualQuantity: "3", unitPrice: "0.20" },
        ],
        "20.25",
      ),
    ).toEqual({
      materialSubtotalMinor: 12573,
      deliveryCostMinor: 2025,
      totalMinor: 14598,
    });
  });

  it("allows a zero line but requires one positive fact for completion", () => {
    const zero = [
      { materialEnumId: 1, actualQuantity: "0", unit: "шт.", unitPrice: "10" },
    ];
    expect(hasPositiveActualQuantity(zero)).toBe(false);
    expect(hasPositiveActualQuantity([...zero, { ...zero[0], materialEnumId: 2, actualQuantity: "0.1" }])).toBe(true);
  });

  it("rejects negative and malformed numbers", () => {
    expect(() => normalizeDecimal("-1")).toThrow(WarehouseValidationError);
    expect(() => normalizeDecimal("1 2 3x")).toThrow(WarehouseValidationError);
  });
});
