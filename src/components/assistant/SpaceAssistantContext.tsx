"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ExplorerObjectDetails } from "@/types/explorer";
import type { IssCommandSnapshot } from "@/types/iss";
import type { MissionSnapshot } from "@/types/mission";

export type AssistantPage = "mission" | "explorer" | "iss" | "settings";

interface PageDataBase {
  page: AssistantPage;
  status: "loading" | "ready" | "error" | "unavailable";
  error?: string;
}

export type SpaceAssistantPageData =
  | (PageDataBase & { page: "mission"; snapshot?: MissionSnapshot })
  | (PageDataBase & { page: "explorer"; object?: ExplorerObjectDetails })
  | (PageDataBase & { page: "iss"; snapshot?: IssCommandSnapshot })
  | (PageDataBase & { page: "settings" });

interface SpaceAssistantContextValue {
  pageData: SpaceAssistantPageData | null;
  publishPageData: (data: SpaceAssistantPageData) => void;
}

const SpaceAssistantContext = createContext<SpaceAssistantContextValue | null>(null);

export function SpaceAssistantProvider({ children }: { children: React.ReactNode }) {
  const [pageData, setPageData] = useState<SpaceAssistantPageData | null>(null);
  const publishPageData = useCallback((data: SpaceAssistantPageData) => setPageData(data), []);
  const value = useMemo(() => ({ pageData, publishPageData }), [pageData, publishPageData]);

  return <SpaceAssistantContext.Provider value={value}>{children}</SpaceAssistantContext.Provider>;
}

export function useSpaceAssistantContext() {
  const context = useContext(SpaceAssistantContext);
  if (!context) throw new Error("useSpaceAssistantContext must be used within a SpaceAssistantProvider");
  return context;
}

export function useSpaceAssistantPublisher() {
  return useSpaceAssistantContext().publishPageData;
}
