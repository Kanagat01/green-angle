"use client";

import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { api, type Schemas } from "./client";

export type VehicleItem = Schemas["VehicleListItemDto"];
export type VehicleCard = Schemas["VehicleCardDto"];
export type VehicleList = Schemas["VehicleListDto"];
export type RequestItem = Schemas["RequestViewDto"];
export type RequestList = Schemas["RequestListDto"];
export type Message = Schemas["MessageViewDto"];
export type ClientType = Schemas["VehicleClientDto"]["type"];

/** Сколько записей запрашиваем за раз: максимум, который отдаёт API */
export const PAGE = 200;

const keys = {
  vehicles: ["vehicles"] as const,
  vehicle: (id: string) => ["vehicle", id] as const,
  requests: ["requests"] as const,
  request: (id: string) => ["request", id] as const,
  messages: (id: string) => ["messages", id] as const,
  unread: ["unread"] as const,
  counts: ["request-counts"] as const,
  clients: ["clients"] as const,
};

/* ---------- чтение ---------- */

export function useVehicles(params: { search?: string; state?: "active" | "ready" }) {
  return useQuery({
    queryKey: [...keys.vehicles, "client", params],
    queryFn: () => api<VehicleList>("/vehicles", { query: { ...params, limit: PAGE } }),
    placeholderData: keepPreviousData,
  });
}

export function useAdminVehicles(params: { vin?: string; ownerType?: ClientType }) {
  return useQuery({
    queryKey: [...keys.vehicles, "admin", params],
    queryFn: () => api<VehicleList>("/admin/vehicles", { query: { ...params, limit: PAGE } }),
    placeholderData: keepPreviousData,
  });
}

/** Карточка машины: тот же маршрут для клиента (только своя) и для менеджера (любая). */
export function useVehicle(id: string) {
  return useQuery({ queryKey: keys.vehicle(id), queryFn: () => api<VehicleCard>(`/vehicles/${id}`), enabled: id !== "" });
}

export function useRequests() {
  return useQuery({
    queryKey: [...keys.requests, "client"],
    queryFn: () => api<RequestList>("/requests", { query: { limit: PAGE } }),
  });
}

export function useAdminRequests(awaiting: boolean) {
  return useQuery({
    queryKey: [...keys.requests, "admin", awaiting],
    queryFn: () => api<RequestList>("/admin/requests", { query: { limit: PAGE, awaiting: awaiting ? true : undefined } }),
    placeholderData: keepPreviousData,
  });
}

export function useRequest(id: string) {
  return useQuery({ queryKey: keys.request(id), queryFn: () => api<RequestItem>(`/requests/${id}`) });
}

export function useRequestCounts(enabled: boolean) {
  return useQuery({
    queryKey: keys.counts,
    queryFn: () => api<Schemas["RequestCountsDto"]>("/admin/requests/counts"),
    enabled,
  });
}

export function useUnreadTotal() {
  return useQuery({
    queryKey: keys.unread,
    queryFn: () => api<Schemas["UnreadCountDto"]>("/requests/unread-count"),
  });
}

/** Диалог: страницы от новых к старым; «Показать ранние» подгружает следующую. */
export function useMessages(requestId: string) {
  const query = useInfiniteQuery({
    queryKey: keys.messages(requestId),
    queryFn: ({ pageParam }) =>
      api<Schemas["MessageListDto"]>(`/requests/${requestId}/messages`, { query: { limit: 50, before: pageParam } }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.hasMore && last.items.length ? last.items[0].id : undefined),
  });
  const items = query.data ? query.data.pages.slice().reverse().flatMap((p) => p.items) : undefined;
  return { ...query, items };
}

/** Поиск клиента по точному имени и типу среди клиентов менеджера (чтобы не плодить дубли). */
export async function findClient(name: string, type: ClientType): Promise<Schemas["ClientListItemDto"] | undefined> {
  const res = await api<Schemas["ClientListDto"]>("/admin/clients", { query: { search: name, type, limit: PAGE } });
  const wanted = name.trim().toLowerCase();
  return res.items.find((c) => c.type === type && c.name.trim().toLowerCase() === wanted);
}

/* ---------- изменения ---------- */

/** Что обновить после изменения заявки или диалога */
export function invalidateRequest(client: QueryClient, requestId?: string) {
  void client.invalidateQueries({ queryKey: keys.requests });
  void client.invalidateQueries({ queryKey: keys.unread });
  void client.invalidateQueries({ queryKey: keys.counts });
  if (requestId) {
    void client.invalidateQueries({ queryKey: keys.request(requestId) });
    void client.invalidateQueries({ queryKey: keys.messages(requestId) });
  }
}

export function invalidateVehicle(client: QueryClient, id?: string) {
  void client.invalidateQueries({ queryKey: keys.vehicles });
  if (id) void client.invalidateQueries({ queryKey: keys.vehicle(id) });
}

export function useCreateRequest() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: Schemas["CreateRequestDto"]) => api<RequestItem>("/requests", { method: "POST", body }),
    onSuccess: (created) => invalidateRequest(client, created.id),
  });
}

export function useSendMessage(requestId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: Schemas["CreateMessageDto"]) =>
      api<Message>(`/requests/${requestId}/messages`, { method: "POST", body }),
    onSuccess: () => invalidateRequest(client, requestId),
  });
}

export function useMarkRead(requestId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api<Schemas["UnreadCountDto"]>(`/requests/${requestId}/read`, { method: "POST" }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.requests });
      void client.invalidateQueries({ queryKey: keys.unread });
      void client.invalidateQueries({ queryKey: keys.request(requestId) });
    },
  });
}

export function useApproveRequest(requestId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api<Schemas["ApproveRequestResultDto"]>(`/admin/requests/${requestId}/approve`, { method: "POST" }),
    onSuccess: () => {
      invalidateRequest(client, requestId);
      invalidateVehicle(client);
    },
  });
}

export function useRejectRequest(requestId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api<RequestItem>(`/admin/requests/${requestId}/reject`, { method: "POST" }),
    onSuccess: () => invalidateRequest(client, requestId),
  });
}

export function useSetVin(vehicleId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (vin: string) => api<VehicleCard>(`/admin/vehicles/${vehicleId}`, { method: "PATCH", body: { vin } }),
    onSuccess: () => invalidateVehicle(client, vehicleId),
  });
}

export function useChangeStatus(vehicleId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: Schemas["ChangeStatusDto"]) =>
      api<VehicleCard>(`/admin/vehicles/${vehicleId}/status`, { method: "POST", body }),
    onSuccess: (card) => {
      invalidateVehicle(client, vehicleId);
      if (card.requestId) invalidateRequest(client, card.requestId);
    },
  });
}

export function useCreateVehicle() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: Schemas["CreateVehicleDto"]) => api<VehicleCard>("/admin/vehicles", { method: "POST", body }),
    onSuccess: () => invalidateVehicle(client),
  });
}

export function useUpdateVehicleNotifications(vehicleId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: Schemas["UpdateVehicleNotificationsDto"]) =>
      api<VehicleCard>(`/vehicles/${vehicleId}/notifications`, { method: "PATCH", body }),
    onSuccess: () => invalidateVehicle(client, vehicleId),
  });
}
