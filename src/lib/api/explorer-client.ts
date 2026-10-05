import { fetchClientJson } from "@/lib/performance/client-request";
import type { ExplorerObjectDetails, ExplorerSearchResponse } from "@/types/explorer";

export async function fetchExplorerSearch(query: string): Promise<ExplorerSearchResponse> {
  return fetchClientJson<ExplorerSearchResponse>(`/api/explorer/search?q=${encodeURIComponent(query)}`, "explorer search");
}

export async function fetchExplorerObject(id: string): Promise<ExplorerObjectDetails> {
  const response = await fetchClientJson<{ object: ExplorerObjectDetails }>(`/api/explorer/object/${encodeURIComponent(id)}`, "object detail");
  return response.object;
}
