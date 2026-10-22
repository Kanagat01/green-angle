import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./client";
import { checkVin } from "./public";

const fetchMock = vi.fn<typeof fetch>();
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

describe("checkVin", () => {
  const found = {
    title: "Geely Monjaro, 2024",
    currentStep: 9,
    currentStepTitle: "Прибыла на СВХ",
    totalSteps: 13,
    progress: 0.69,
    updatedAt: "2026-09-26T10:00:00.000Z",
  };

  it("asks the public endpoint without credentials and returns the status", async () => {
    fetchMock.mockResolvedValue(json(200, found));
    expect(await checkVin("LVSHCAMB5RE077734")).toEqual(found);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("http://localhost:4000/api/v1/public/vehicle-status?vin=LVSHCAMB5RE077734");
    expect((init?.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it("returns null for an unknown VIN", async () => {
    fetchMock.mockResolvedValue(json(404, { message: "Vehicle not found" }));
    expect(await checkVin("LVSHCAMB5RE077734")).toBeNull();
  });

  it("lets the rate limit and other errors through", async () => {
    fetchMock.mockResolvedValue(json(429, { message: "Too many requests" }));
    await expect(checkVin("LVSHCAMB5RE077734")).rejects.toMatchObject({ status: 429 });
    fetchMock.mockRejectedValue(new TypeError("offline"));
    const err = await checkVin("LVSHCAMB5RE077734").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(0);
  });
});
