import type { ItemView, ListView } from "@/lib/lists/service";

/**
 * Browser-side API client.
 *
 * Thin on purpose: it knows about URLs and error shapes, nothing else. Offline
 * queueing arrives in phase 4 and wraps this rather than replacing it.
 */

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiError(body.error ?? "Yhteys epäonnistui", response.status);
  }

  return response.json() as Promise<T>;
}

export interface CreatedList {
  id: string;
  token: string;
  memberId: string | null;
  url: string;
}

export const api = {
  createList: (name: string, nickname?: string) =>
    request<CreatedList>("/api/lists", {
      method: "POST",
      body: JSON.stringify({ name, ...(nickname ? { nickname } : {}) }),
    }),

  getList: (token: string) => request<ListView>(`/api/lists/${token}`),

  addItem: (
    token: string,
    input: {
      id?: string;
      ean?: string | null;
      freeText?: string | null;
      nameSnapshot?: string | null;
      priceCentsSnapshot?: number | null;
      aisleName?: string | null;
      aisleOrder?: number | null;
      qty?: number;
      qtyUnit?: string;
      addedBy?: string | null;
    },
  ) =>
    request<{ item: ItemView; merged: boolean }>(`/api/lists/${token}/items`, {
      method: "POST",
      body: JSON.stringify(input),
    }),

  updateItem: (
    token: string,
    itemId: string,
    input: {
      qty?: number;
      qtyUnit?: string;
      note?: string | null;
      checked?: boolean;
      updatedAt?: string;
      updatedBy?: string | null;
    },
  ) =>
    request<ItemView>(`/api/lists/${token}/items/${itemId}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),

  deleteItem: (token: string, itemId: string, by?: string | null) =>
    request<ItemView>(
      `/api/lists/${token}/items/${itemId}${by ? `?by=${encodeURIComponent(by)}` : ""}`,
      { method: "DELETE" },
    ),
};
