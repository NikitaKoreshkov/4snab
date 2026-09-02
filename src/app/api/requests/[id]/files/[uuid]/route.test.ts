import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUserByToken: vi.fn(),
  getRequestFile: vi.fn(),
  downloadDriveFile: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getUserByToken: mocks.getUserByToken }));
vi.mock("@/lib/requests", () => ({ getRequestFile: mocks.getRequestFile }));
vi.mock("@/lib/amocrm", () => ({ downloadDriveFile: mocks.downloadDriveFile }));

import { GET } from "./route";

const uuid = "11111111-1111-4111-8111-111111111111";
const context = { params: Promise.resolve({ id: "123", uuid }) };

function request(token = "valid-token", preview = false) {
  return new NextRequest(
    `http://localhost/api/requests/123/files/${uuid}?token=${token}${preview ? "&variant=preview" : ""}`,
  );
}

describe("invoice content proxy", () => {
  beforeEach(() => {
    mocks.getUserByToken.mockReturnValue({ token: "valid-token", name: "Склад" });
    mocks.getRequestFile.mockResolvedValue({
      uuid,
      name: "накладная.jpg",
      size: 3,
      type: "image/jpeg",
      createdAt: "2026-09-02T10:00:00.000Z",
      downloadUrl: "https://drive.example/download/full.jpg",
      previewUrl: "https://drive.example/download/preview.jpg",
    });
    mocks.downloadDriveFile.mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        headers: { "Content-Type": "image/jpeg", "Content-Length": "3" },
      }),
    );
  });

  it("requires a warehouse token", async () => {
    mocks.getUserByToken.mockReturnValue(null);
    expect((await GET(request("bad"), context)).status).toBe(401);
    expect(mocks.downloadDriveFile).not.toHaveBeenCalled();
  });

  it("streams a linked file inline through the server", async () => {
    const response = await GET(request(), context);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("content-disposition")).toContain("inline");
    expect((await response.arrayBuffer()).byteLength).toBe(3);
    expect(mocks.downloadDriveFile).toHaveBeenCalledWith(
      "https://drive.example/download/full.jpg",
    );
  });

  it("uses amoCRM preview when one is available", async () => {
    expect((await GET(request("valid-token", true), context)).status).toBe(200);
    expect(mocks.downloadDriveFile).toHaveBeenCalledWith(
      "https://drive.example/download/preview.jpg",
    );
  });
});
