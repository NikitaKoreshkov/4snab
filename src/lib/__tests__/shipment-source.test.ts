import { describe, expect, it } from "vitest";
import {
  sourceDate,
  sourceMaterials,
  sourceNumber,
  sourceText,
} from "../shipment-source";

function lead(values: Array<{ value: unknown; enum_id?: number }> = []) {
  return {
    custom_fields_values: [
      {
        field_id: 10,
        values,
      },
    ],
  };
}

describe("shipment source fields", () => {
  it("reads one selected material", () => {
    expect(sourceMaterials(lead([{ value: "ПГС", enum_id: 101 }]), 10)).toEqual([
      { enumId: 101, name: "ПГС", sortOrder: 0 },
    ]);
  });

  it("reads every unique value from an amoCRM multiselect", () => {
    expect(
      sourceMaterials(
        lead([
          { value: "ПГС", enum_id: 101 },
          { value: "Щебень", enum_id: 202 },
          { value: "ПГС", enum_id: 101 },
        ]),
        10,
      ),
    ).toEqual([
      { enumId: 101, name: "ПГС", sortOrder: 0 },
      { enumId: 202, name: "Щебень", sortOrder: 1 },
    ]);
  });

  it("creates a stable synthetic id when amoCRM omits enum_id", () => {
    const first = sourceMaterials(lead([{ value: "Песок" }]), 10)[0];
    const second = sourceMaterials(lead([{ value: "Песок" }]), 10)[0];
    expect(first.enumId).toBeLessThan(0);
    expect(second.enumId).toBe(first.enumId);
  });

  it("reads number, text and date fields", () => {
    const source = lead([{ value: 1_788_134_400 }]);
    expect(sourceNumber(source, 10)).toBe(1_788_134_400);
    expect(sourceText(lead([{ value: "  Объект  " }]), 10)).toBe("Объект");
    expect(sourceDate(source, 10)).toBe("2026-08-31");
  });
});
