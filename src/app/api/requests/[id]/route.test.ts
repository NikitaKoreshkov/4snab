import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  WarehouseConflictError,
  WarehouseLockedError,
  WarehouseValidationError,
} from "@/lib/warehouse-types";

const mocks = vi.hoisted(() => ({
  getUserByToken: vi.fn(),
  getRequest: vi.fn(),
  saveWarehouseRequest: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getUserByToken: mocks.getUserByToken }));
vi.mock("@/lib/requests", () => ({
  getRequest: mocks.getRequest,
  saveWarehouseRequest: mocks.saveWarehouseRequest,
}));

import { GET, PATCH } from "./route";

const context = {
  params: Promise.resolve({ id: "123" }),
} as RouteContext<"/api/requests/[id]">;

function request(method: "GET" | "PATCH", body?: unknown, token = "valid-token") {
  return new NextRequest(`http://localhost/api/requests/123?token=${token}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const draftPayload = {
  action: "draft" as const,
  version: 2,
  palletCount: null,
  deliveryCost: null,
  items: [
    {
      materialEnumId: 10,
      actualQuantity: null,
      unit: null,
      unitPrice: null,
    },
  ],
};

describe("warehouse request API", () => {
  beforeEach(() => {
    mocks.getUserByToken.mockReturnValue({ token: "valid-token", name: "Склад" });
    mocks.getRequest.mockResolvedValue({ id: 123 });
    mocks.saveWarehouseRequest.mockResolvedValue({ id: 123, draft: { version: 3 } });
  });

  it("requires authorization", async () => {
    mocks.getUserByToken.mockReturnValue(null);
    expect((await GET(request("GET", undefined, "bad"), context)).status).toBe(401);
    expect((await PATCH(request("PATCH", draftPayload, "bad"), context)).status).toBe(401);
  });

  it("allows an incomplete draft and passes the actor", async () => {
    const response = await PATCH(request("PATCH", draftPayload), context);
    expect(response.status).toBe(200);
    expect(mocks.saveWarehouseRequest).toHaveBeenCalledWith(123, draftPayload, "Склад");
  });

  it("rejects malformed numbers before the domain call", async () => {
    const response = await PATCH(
      request("PATCH", { ...draftPayload, deliveryCost: "-10" }),
      context,
    );
    expect(response.status).toBe(400);
    expect(mocks.saveWarehouseRequest).not.toHaveBeenCalled();
  });

  it.each([
    [new WarehouseConflictError(), 409],
    [new WarehouseLockedError(), 423],
    [new WarehouseValidationError("Ошибка"), 400],
  ])("maps domain errors to API statuses", async (error, status) => {
    mocks.saveWarehouseRequest.mockRejectedValue(error);
    expect((await PATCH(request("PATCH", draftPayload), context)).status).toBe(status);
  });
});
