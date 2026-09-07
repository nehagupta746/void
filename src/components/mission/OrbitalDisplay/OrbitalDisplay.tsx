"use client";

import { memo, useMemo } from "react";
import { AsteroidTrackerEngineBoundary } from "@/components/3d/Asteroids/AsteroidTrackerEngineBoundary";
import type { AsteroidContact } from "@/components/3d/Asteroids/AsteroidTrackerScene";
import { useMissionSnapshot } from "@/hooks/useMissionSnapshot";

const fallbackContacts: AsteroidContact[] = [
  { id: "fallback-1", label: "Astra-01", risk: "low" },
  { id: "fallback-2", label: "Astra-02", risk: "low" },
  { id: "fallback-3", label: "Astra-03", risk: "elevated" },
  { id: "fallback-4", label: "Astra-04", risk: "low" },
  { id: "fallback-5", label: "Astra-05", risk: "low" },
  { id: "fallback-6", label: "Astra-06", risk: "elevated" },
];

export const OrbitalDisplay = memo(function OrbitalDisplay() {
  const mission = useMissionSnapshot();
  const contacts = useMemo<AsteroidContact[]>(() => {
    const approaches = mission.data?.closeApproaches ?? [];
    const activeContacts = approaches.slice(0, 6).map((approach) => ({ id: approach.id, label: approach.name, risk: approach.risk }));
    return [...activeContacts, ...fallbackContacts].slice(0, 6);
  }, [mission.data?.closeApproaches]);
  const status = mission.loading ? "Acquiring NEO telemetry" : mission.error ? "NEO link delayed" : `${contacts.length} trajectories active`;
  return <AsteroidTrackerEngineBoundary contacts={contacts} status={status} />;
});
