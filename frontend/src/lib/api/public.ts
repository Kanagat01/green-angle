import { ApiError, api, type Schemas } from "./client";

export type PublicVehicleStatus = Schemas["PublicVehicleStatusDto"];

/** Проверка этапа по VIN без входа. Неизвестный VIN — null; слишком частые проверки — ApiError 429. */
export async function checkVin(vin: string): Promise<PublicVehicleStatus | null> {
  try {
    return await api<PublicVehicleStatus>("/public/vehicle-status", { anonymous: true, query: { vin } });
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}
