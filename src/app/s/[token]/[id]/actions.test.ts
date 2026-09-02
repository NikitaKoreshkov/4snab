import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUserByToken: vi.fn(),
  saveWarehouseRequest: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getUserByToken: mocks.getUserByToken }));
vi.mock("@/lib/requests", () => ({
  saveWarehouseRequest: mocks.saveWarehouseRequest,
}));

import { saveRequestAction } from "./actions";

describe("warehouse draft form action", () => {
  beforeEach(() => {
    mocks.getUserByToken.mockReturnValue({ token: "warehouse-token", name: "Склад" });
    mocks.saveWarehouseRequest.mockResolvedValue({});
  });

  it("uses the current visible price even if hidden JSON is one render behind", async () => {
    const formData = new FormData();
    formData.set("token", "warehouse-token");
    formData.set("id", "123");
    formData.set("version", "2");
    formData.set("action", "draft");
    formData.set("palletCount", "0");
    formData.set("deliveryCost", "5 000");
    formData.set(
      "itemsJson",
      JSON.stringify([
        { materialEnumId: 10, actualQuantity: "1", unit: "шт.", unitPrice: "1" },
      ]),
    );
    formData.set("items.10.actualQuantity", "2.5");
    formData.set("items.10.unitChoice", "шт.");
    formData.set("items.10.unitPrice", "100 000,50");

    expect(await saveRequestAction({ ok: false }, formData)).toMatchObject({ ok: true });
    expect(mocks.saveWarehouseRequest).toHaveBeenCalledWith(
      123,
      expect.objectContaining({
        deliveryCost: "5 000",
        items: [
          expect.objectContaining({
            materialEnumId: 10,
            actualQuantity: "2.5",
            unit: "шт.",
            unitPrice: "100 000,50",
          }),
        ],
      }),
      "Склад",
    );
  });
});
