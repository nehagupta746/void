"use client";

import { motion } from "framer-motion";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useSpaceAssistantPublisher } from "@/components/assistant/SpaceAssistantContext";
import { CommandButton } from "@/components/ui/CommandButton";
import { HUDPanel } from "@/components/ui/HUDPanel";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { useExplorerObject, useExplorerSearch } from "@/hooks/useExplorer";
import type { ExplorerApproach, ExplorerObjectDetails, ExplorerObjectSummary } from "@/types/explorer";

const SEARCH_DEBOUNCE_MS = 500;
const dateFormatter = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
const numberFormatter = new Intl.NumberFormat("en", { maximumFractionDigits: 2 });
const compactFormatter = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 2 });

function formatValue(value: number | null, suffix = ""): string { return value === null ? "Data unavailable" : `${numberFormatter.format(value)}${suffix}`; }
function formatCompact(value: number | null, suffix = ""): string { return value === null ? "Data unavailable" : `${compactFormatter.format(value)}${suffix}`; }
function formatVelocity(valueKph: number | null): string { return valueKph === null ? "Data unavailable" : `${formatCompact(valueKph / 3600, " km/s")} (${formatCompact(valueKph, " km/h")})`; }
function formatDiameterRange(min: number | null, max: number | null): string { if (min === null && max === null) return "Diameter unavailable"; if (min === null) return `Up to ${formatValue(max, " km")}`; if (max === null) return `At least ${formatValue(min, " km")}`; if (min === max) return formatValue(min, " km"); return `${formatValue(min, " km")} — ${formatValue(max, " km")}`; }
function formatDate(value: string | null): string { return value ? dateFormatter.format(new Date(`${value}T00:00:00Z`)) : "Data unavailable"; }
function readableError(error: Error | null): string { return error?.message || "Registry telemetry is temporarily unavailable"; }
function orbitalClassExplanation(orbitalClass: string | null): string { if (!orbitalClass) return "NASA/JPL classification unavailable"; const normalized = orbitalClass.toLowerCase(); if (normalized.includes("aten")) return "Aten: near-Earth orbit with a shorter period than Earth"; if (normalized.includes("apollo")) return "Apollo: near-Earth orbit that crosses Earth's orbit"; if (normalized.includes("amor")) return "Amor: approaches Earth's orbit but does not cross it"; if (normalized.includes("atira")) return "Atira: orbit remains inside Earth's orbit"; if (normalized.includes("main belt")) return "Main-belt object: stable orbit between Mars and Jupiter"; return "Published orbital classification from NASA/JPL"; }
function threatLabel(hazardous: boolean | null): string { return hazardous === true ? "Potentially hazardous" : hazardous === false ? "Not classified as potentially hazardous" : "Hazard classification unavailable"; }

function mergeObjectSummary(details: ExplorerObjectDetails | undefined, summary: ExplorerObjectSummary | undefined): ExplorerObjectDetails | undefined {
  if (!details || !summary) return details;
  return {
    ...details,
    nasaId: details.nasaId ?? summary.nasaId,
    designation: details.designation || summary.designation,
    estimatedDiameterMinKm: details.estimatedDiameterMinKm ?? summary.estimatedDiameterMinKm,
    estimatedDiameterMaxKm: details.estimatedDiameterMaxKm ?? summary.estimatedDiameterMaxKm,
    hazardous: details.hazardous ?? summary.hazardous,
    absoluteMagnitude: details.absoluteMagnitude ?? summary.absoluteMagnitude,
    orbitalPeriodDays: details.orbitalPeriodDays ?? summary.orbitalPeriodDays,
    orbitalClass: details.orbitalClass ?? summary.orbitalClass ?? null,
    orbitalClassCode: details.orbitalClassCode ?? summary.orbitalClassCode ?? null,
    semiMajorAxisAu: details.semiMajorAxisAu ?? summary.semiMajorAxisAu ?? null,
    eccentricity: details.eccentricity ?? summary.eccentricity ?? null,
    inclinationDegrees: details.inclinationDegrees ?? summary.inclinationDegrees ?? null,
    perihelionDistanceAu: details.perihelionDistanceAu ?? summary.perihelionDistanceAu ?? null,
    earthMoidAu: details.earthMoidAu ?? summary.earthMoidAu ?? null,
    isNearEarthObject: details.isNearEarthObject ?? summary.isNearEarthObject ?? null,
    firstObservationDate: details.firstObservationDate ?? summary.firstObservationDate,
    lastObservationDate: details.lastObservationDate ?? summary.lastObservationDate,
    closeApproachCount: details.closeApproachCount ?? summary.closeApproachCount ?? 0,
  };
}

function getThreatAssessment(object: ExplorerObjectDetails | undefined): { score: number | null; label: string; factors: { label: string; basis: string; value: number | null }[] } | null {
  if (!object) return null;
  const diameterKm = (() => {
    const diameterKm = Math.max(object.estimatedDiameterMinKm ?? 0, object.estimatedDiameterMaxKm ?? 0);
    return Number.isFinite(diameterKm) && diameterKm > 0 ? diameterKm : null;
  })();
  const size = diameterKm !== null
    ? diameterKm >= 5 ? 95 : diameterKm >= 1 ? 78 : diameterKm >= 0.25 ? 62 : 35
    : object.absoluteMagnitude !== null
      ? object.absoluteMagnitude <= 13 ? 95 : object.absoluteMagnitude <= 16 ? 78 : object.absoluteMagnitude <= 19 ? 62 : 35
      : null;
  const sizeBasis = diameterKm !== null ? "Published diameter" : object.absoluteMagnitude !== null ? `H magnitude ${formatValue(object.absoluteMagnitude)} (size proxy)` : "No diameter or H magnitude reported";
  const closest = closestApproach(object.approaches);
  const closestApproachDistance = closest?.missDistanceKm ?? null;
  const earthMoidKm = object.earthMoidAu == null ? null : object.earthMoidAu * 149597870.7;
  const distanceKm = closestApproachDistance ?? earthMoidKm;
  const distance = distanceKm === null ? null : distanceKm <= 500000 ? 94 : distanceKm <= 5000000 ? 78 : distanceKm <= 20000000 ? 63 : 38;
  const distanceBasis = closestApproachDistance !== null
    ? `Closest recorded ${formatCompact(closestApproachDistance, " km")}`
    : earthMoidKm !== null ? `Earth MOID ${formatValue(object.earthMoidAu ?? null, " AU")} (orbit proxy)` : "No approach or Earth MOID reported";
  const velocity = closest?.relativeVelocityKph ?? null;
  const velocityScore = velocity === null ? null : velocity >= 60000 ? 92 : velocity >= 30000 ? 76 : velocity >= 15000 ? 56 : 32;
  const phaScore = object.hazardous === true ? 95 : object.hazardous === false ? 16 : null;
  const scoredFactors = [
    { value: size, weight: 0.3 },
    { value: distance, weight: 0.25 },
    { value: velocityScore, weight: 0.2 },
    { value: phaScore, weight: 0.25 },
  ].filter((factor): factor is { value: number; weight: number } => factor.value !== null);
  const totalWeight = scoredFactors.reduce((total, factor) => total + factor.weight, 0);
  const score = totalWeight > 0 ? Math.round(scoredFactors.reduce((total, factor) => total + factor.value * factor.weight, 0) / totalWeight) : null;
  return {
    score: score === null ? null : Math.min(100, Math.max(0, score)),
    label: object.hazardous === true ? "Potentially hazardous" : object.hazardous === false ? "Not classified hazardous" : "Hazard classification unavailable",
    factors: [
      { label: "SIZE", basis: sizeBasis, value: size },
      { label: "DISTANCE", basis: distanceBasis, value: distance },
      { label: "RELATIVE VELOCITY", basis: velocity === null ? "No close-approach velocity reported" : `${formatCompact(velocity, " km/h")} at closest recorded approach`, value: velocityScore },
      { label: "PHA STATUS", basis: "NASA/JPL classification", value: phaScore },
    ],
  };
}

function renderThreatBar(value: number | null): string {
  if (value === null) return "NOT AVAILABLE";
  const filled = Math.round((value / 100) * 10);
  return `${"█".repeat(Math.max(0, filled))}${"░".repeat(Math.max(0, 10 - filled))}`;
}

const Field = memo(function Field({ label, value, help }: { label: string; value: string; help?: string }) {
  return <div className="border-t border-[var(--color-line)] pt-[var(--space-1)]"><div className="flex items-center gap-1"><p className="m-0 text-[0.5625rem] uppercase tracking-[0.15em] text-[var(--color-muted)]">{label}</p>{help && <InfoTooltip label={label} content={help} />}</div><p className="m-0 mt-1 break-words text-xs uppercase tracking-[0.06em] text-[var(--color-information)]">{value}</p></div>;
});

const ApproachAlerts = memo(function ApproachAlerts({ approaches, hazardous, earthMoidAu }: { approaches: ExplorerApproach[]; hazardous: boolean | null; earthMoidAu: number | null }) {
  const today = new Date().toISOString().slice(0, 10);
  const normalizedApproaches = [...approaches]
    .filter((approach) => approach.date >= today)
    .sort((left, right) => left.date.localeCompare(right.date))
    .slice(0, 3);
  if (!normalizedApproaches.length) return <div className="border border-[var(--color-line)] bg-[var(--color-panel)] px-[var(--space-2)] py-[var(--space-2)] text-xs uppercase tracking-[0.1em] text-[var(--color-muted)]"><p className="m-0">No upcoming Earth encounter is reported by NASA/JPL. {approaches.length ? `${approaches.length} past Earth encounter${approaches.length === 1 ? "" : "s"} shown in the timeline.` : "No Earth encounter records were returned for this object."}</p><p className="m-0 mt-1">Closest orbital proximity (Earth MOID): {formatValue(earthMoidAu, " AU")}. MOID is orbit geometry, not a predicted encounter.</p></div>;
  return <div className="mt-[var(--space-2)] space-y-[var(--space-1)]">{normalizedApproaches.map((approach) => {
    const dateValue = new Date(`${approach.date}T00:00:00Z`);
    const now = Date.now();
    const remainingMs = dateValue.getTime() - now;
    const approachDays = Math.max(0, Math.floor(remainingMs / 86400000));
    const approachHours = Math.max(0, Math.floor((remainingMs % 86400000) / 3600000));
    const distanceKm = approach.missDistanceKm;
    // These UI thresholds are intentionally conservative application labels and are not NASA official risk ratings.
    const urgency = hazardous === true ? "Potentially hazardous classification" : distanceKm !== null && distanceKm <= 5000000 ? "Very close" : distanceKm !== null && distanceKm <= 15000000 ? "Close approach" : "Upcoming";
    return <div key={`${approach.date}-${approach.orbitingBody ?? "unknown"}`} className="border border-[var(--color-line)] bg-[var(--color-panel)] px-[var(--space-2)] py-[var(--space-1)]"><div className="flex items-center justify-between gap-[var(--space-2)]"><span className="text-[0.5625rem] uppercase tracking-[0.12em] text-[var(--color-primary)]">{urgency}</span><span className="text-[0.5625rem] uppercase tracking-[0.12em] text-[var(--color-muted)]">{formatDate(approach.date)}</span></div><p className="m-0 mt-1 text-[0.625rem] uppercase tracking-[0.08em] text-[var(--color-information)]">Time to approach: {approachDays}d {approachHours}h</p><div className="mt-1 grid grid-cols-2 gap-x-[var(--space-1)] text-[0.5625rem] uppercase tracking-[0.08em] text-[var(--color-muted)]"><span>Miss distance: {formatCompact(distanceKm, " km")}</span><span>Relative velocity: {formatVelocity(approach.relativeVelocityKph)}</span></div></div>;
  })}</div>;
});

function closestApproach(approaches: ExplorerApproach[]): ExplorerApproach | null {
  return approaches.reduce<ExplorerApproach | null>((closest, approach) => {
    if (approach.missDistanceKm === null) return closest;
    if (!closest || closest.missDistanceKm === null || approach.missDistanceKm < closest.missDistanceKm) return approach;
    return closest;
  }, null);
}

const ObjectDetailsPanel = memo(function ObjectDetailsPanel({ object, loading, error }: { object: ExplorerObjectDetails | undefined; loading: boolean; error: Error | null }) {
  const threat = useMemo(() => getThreatAssessment(object), [object]);
  if (loading) return <HUDPanel title="Object details" eyebrow="Detail / Synchronizing"><p className="m-0 py-[var(--space-3)] text-xs uppercase tracking-[0.12em] text-[var(--color-muted)]">Receiving orbital record<span className="terminal-cursor">_</span></p></HUDPanel>;
  if (error) return <HUDPanel title="Object details" eyebrow="Detail / Delayed"><p className="m-0 py-[var(--space-3)] text-xs uppercase tracking-[0.12em] text-[var(--color-danger)]">{readableError(error)}</p></HUDPanel>;
  if (!object) return <HUDPanel title="Object details" eyebrow="Detail / Standby"><p className="m-0 py-[var(--space-3)] text-xs uppercase tracking-[0.12em] text-[var(--color-muted)]">Select a registry object to load its orbital record<span className="terminal-cursor">_</span></p></HUDPanel>;
  const closest = closestApproach(object.approaches);
  const assessmentValue = threat?.score === null || threat?.score === undefined ? "Partial data" : `${threat.score} / 100`;
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: "easeOut" }}>
      <HUDPanel title={object.designation} eyebrow={object.nasaId ? `NASA NEO ID / ${object.nasaId}` : `JPL designation / ${object.id}`}>
        <div className="grid gap-[var(--space-2)] sm:grid-cols-2">
          <Field label="NASA NEO ID" value={object.nasaId ?? "No NASA NEO identifier"} />
          <Field label="Orbital class / meaning" value={`${object.orbitalClass ?? "Data unavailable"} / ${orbitalClassExplanation(object.orbitalClass)}`} />
          <Field label="Diameter" value={formatDiameterRange(object.estimatedDiameterMinKm, object.estimatedDiameterMaxKm)} />
          <Field label="Threat classification" value={threatLabel(object.hazardous)} />
        </div>
        <details className="disclosure-panel mt-[var(--space-2)]">
          <summary>Orbital parameters and catalog details</summary>
          <div className="grid gap-[var(--space-2)] p-[var(--space-2)] sm:grid-cols-2">
            <Field label="Absolute magnitude (H)" value={formatValue(object.absoluteMagnitude)} help="H magnitude is a size proxy when direct size data is unavailable." />
            <Field label="Orbital period" value={formatValue(object.orbitalPeriodDays, " days")} />
            <Field label="Semi-major axis" value={formatValue(object.semiMajorAxisAu ?? null, " AU")} />
            <Field label="Eccentricity" value={formatValue(object.eccentricity ?? null)} />
            <Field label="Inclination" value={formatValue(object.inclinationDegrees ?? null, "°")} />
            <Field label="Perihelion distance" value={formatValue(object.perihelionDistanceAu ?? null, " AU")} />
            <Field label="Earth MOID" value={formatValue(object.earthMoidAu ?? null, " AU")} help="MOID is orbit geometry, not a predicted encounter." />
            <Field label="Near-Earth object" value={object.isNearEarthObject === true ? "Yes" : object.isNearEarthObject === false ? "No" : "Data unavailable"} />
            <Field label="Discovery date" value={formatDate(object.discoveryDate)} />
            <Field label="Last observed" value={formatDate(object.lastObservationDate)} />
          </div>
        </details>
        {threat && (
          <details className="disclosure-panel mt-[var(--space-2)]">
            <summary><span>Threat assessment</span><span>{assessmentValue}</span></summary>
            <div className="border-t border-[var(--color-line)] p-[var(--space-2)]">
              <p className="m-0 text-[0.625rem] uppercase tracking-[0.18em] text-[var(--color-accent)]">VOID THREAT ASSESSMENT</p>
              <p className="m-0 mt-2 text-2xl font-medium uppercase tracking-[0.12em] text-[var(--color-information)]">{assessmentValue}</p>
              <p className="m-0 mt-2 text-[0.5625rem] uppercase tracking-[0.12em] text-[var(--color-muted)]">Catalog-based heuristic; H magnitude and Earth MOID are labeled proxies when direct size or encounter data is unavailable. Not an official risk rating.</p>
              <p className="m-0 mt-2 text-[0.625rem] uppercase tracking-[0.12em] text-[var(--color-primary)]">{threat.label}</p>
              {threat.factors.map((factor) => (
                <div key={factor.label} className="mt-[var(--space-1)]">
                  <div className="flex items-center justify-between gap-[var(--space-1)]">
                    <span className="text-[0.5625rem] uppercase tracking-[0.12em] text-[var(--color-muted)]">{factor.label}</span>
                    <span className="text-[0.5625rem] uppercase tracking-[0.12em] text-[var(--color-information)]">{factor.value ?? "Data unavailable"}</span>
                  </div>
                  <p className="m-0 mt-1 text-[0.5rem] uppercase tracking-[0.08em] text-[var(--color-muted)]">{factor.basis}</p>
                  <div className="mt-1 flex items-center gap-[0.125rem] text-[0.5rem] tracking-[0.16em] text-[var(--color-primary)]">
                    {renderThreatBar(factor.value)}
                    {factor.value !== null && <span className="text-[var(--color-muted)]">{factor.value}</span>}
                  </div>
                </div>
              ))}
            </div>
          </details>
        )}
        <details className="disclosure-panel mt-[var(--space-2)]">
          <summary><span>Close approach alerts</span><span>{object.approaches.length ? `${object.approaches.length} recorded` : "No alerts"}</span></summary>
          <div className="border-t border-[var(--color-line)] p-[var(--space-2)]">
            {closest && (
              <div className="mb-[var(--space-2)] border border-[var(--color-primary)]/50 bg-[var(--color-panel)] px-[var(--space-2)] py-[var(--space-1)]">
                <p className="m-0 text-[0.5625rem] uppercase tracking-[0.12em] text-[var(--color-accent)]">Closest recorded approach / {formatDate(closest.date)}</p>
                <div className="mt-1 grid grid-cols-2 gap-[var(--space-1)] text-[0.625rem] uppercase tracking-[0.08em]">
                  <span className="text-[var(--color-information)]">Miss distance: {formatCompact(closest.missDistanceKm, " km")}</span>
                  <span className="text-[var(--color-information)]">Relative velocity: {formatVelocity(closest.relativeVelocityKph)}</span>
                </div>
              </div>
            )}
            <ApproachAlerts approaches={object.approaches} hazardous={object.hazardous} earthMoidAu={object.earthMoidAu ?? null} />
          </div>
        </details>
        <details className="disclosure-panel mt-[var(--space-2)]">
          <summary><span>Approach timeline</span><span>{`${object.approaches.length} recorded`}</span></summary>
          <div className="border-t border-[var(--color-line)] p-[var(--space-2)]">
            <ApproachTimeline approaches={object.approaches} earthMoidAu={object.earthMoidAu ?? null} />
          </div>
        </details>
      </HUDPanel>
    </motion.div>
  );
});

const ApproachTimeline = memo(function ApproachTimeline({ approaches, earthMoidAu }: { approaches: ExplorerApproach[]; earthMoidAu: number | null }) {
  if (!approaches.length) return <div className="border border-[var(--color-line)] bg-[var(--color-panel)] px-[var(--space-2)] py-[var(--space-2)] text-xs uppercase tracking-[0.1em] text-[var(--color-muted)]"><p className="m-0">No Earth close-approach records are reported by NASA/JPL for this object.</p><p className="m-0 mt-1">Closest orbital proximity (Earth MOID): {formatValue(earthMoidAu, " AU")}. MOID is orbit geometry, not a dated approach event.</p></div>;
  return <div className="mt-[var(--space-2)] space-y-[var(--space-1)]">{approaches.map((approach) => <div key={`${approach.date}-${approach.orbitingBody ?? "unknown"}`} className="grid grid-cols-2 gap-x-[var(--space-2)] gap-y-1 border-b border-[var(--color-line)] pb-[var(--space-1)] text-[0.625rem] uppercase tracking-[0.08em] sm:grid-cols-4"><span className="text-[var(--color-information)]">{formatDate(approach.date)}</span><span className="text-[var(--color-muted)]">Miss distance: {formatCompact(approach.missDistanceKm, " km")}</span><span className="text-[var(--color-muted)]">Relative velocity: {formatVelocity(approach.relativeVelocityKph)}</span><span className="text-[var(--color-primary)]">{approach.orbitingBody ?? "Unknown body"}</span></div>)}</div>;
});

function approachSummary(object: ExplorerObjectSummary): string {
  if (object.closeApproachCount > 0) return `${object.closeApproachCount} recorded approaches; select for timeline`;
  if (object.earthMoidAu != null) return `Earth MOID / ${formatValue(object.earthMoidAu, " AU")}; select for encounter records`;
  return "Approach records load when selected";
}

const SearchResult = memo(function SearchResult({ object, selected, onSelect }: { object: ExplorerObjectSummary; selected: boolean; onSelect: (id: string) => void }) {
  return (
    <article className="registry-result overflow-hidden border border-[var(--color-line)] bg-[var(--color-panel)]">
      <button
        type="button"
        onClick={() => onSelect(object.id)}
        aria-pressed={selected}
        className={`command-button w-full border-0 px-[var(--space-2)] py-[var(--space-1)] text-left transition-colors duration-[var(--motion-slow)] ${selected ? "bg-[var(--color-primary)]/10" : "hover:bg-[var(--color-panel-raised)]"}`}
      >
        <div className="flex items-start justify-between gap-[var(--space-2)]">
          <div>
            <p className="m-0 text-xs uppercase tracking-[0.1em] text-[var(--color-information)]">{object.designation}</p>
            <p className="m-0 mt-1 text-[0.625rem] uppercase tracking-[0.1em] text-[var(--color-muted)]">{object.nasaId ? `NASA NEO ID / ${object.nasaId}` : `JPL designation / ${object.id}`}</p>
          </div>
          <span className={object.hazardous === true ? "text-[0.625rem] uppercase tracking-[0.12em] text-[var(--color-danger)]" : "text-[0.625rem] uppercase tracking-[0.12em] text-[var(--color-muted)]"}>Threat / {object.hazardous === true ? "potentially hazardous" : object.hazardous === false ? "not classified hazardous" : "unavailable"}</span>
        </div>
        <p className="m-0 mt-[var(--space-1)] text-[0.625rem] uppercase tracking-[0.08em] text-[var(--color-muted)]">Diameter / {formatDiameterRange(object.estimatedDiameterMinKm, object.estimatedDiameterMaxKm)}</p>
        <p className="m-0 mt-1 text-[0.5625rem] uppercase tracking-[0.08em] text-[var(--color-muted)]">{approachSummary(object)}</p>
      </button>
      <details className="disclosure-panel border-x-0 border-b-0">
        <summary>Technical details</summary>
        <div className="grid grid-cols-2 gap-x-[var(--space-2)] gap-y-[var(--space-1)] border-t border-[var(--color-line)] p-[var(--space-2)] text-[0.625rem] uppercase tracking-[0.08em] text-[var(--color-muted)] sm:grid-cols-3">
          <span>H / {formatValue(object.absoluteMagnitude)}</span>
          <span>Orbital period / {formatCompact(object.orbitalPeriodDays, " days")}</span>
          <span>Orbit class / {object.orbitalClassCode ?? "Unavailable"}</span>
          <span>Semi-major axis / {formatValue(object.semiMajorAxisAu ?? null, " AU")}</span>
          <span>Eccentricity / {formatValue(object.eccentricity ?? null)}</span>
          <span>Inclination / {formatValue(object.inclinationDegrees ?? null, "°")}</span>
          <span>Perihelion / {formatValue(object.perihelionDistanceAu ?? null, " AU")}</span>
          <span>Earth MOID / {formatValue(object.earthMoidAu ?? null, " AU")}</span>
          <span>Last observed / {object.lastObservationDate ? formatDate(object.lastObservationDate) : "Unavailable"}</span>
          <span>PHA / {object.hazardous === true ? "Yes" : object.hazardous === false ? "No" : "Unavailable"}</span>
          <span>NEO / {object.isNearEarthObject === true ? "Yes" : object.isNearEarthObject === false ? "No" : "Unavailable"}</span>
          <span className="col-span-full border-t border-[var(--color-line)] pt-1 text-[var(--color-primary)]">Select to load this object's closest approach, alerts and full timeline</span>
        </div>
      </details>
    </article>
  );
});

const ComparisonPanel = memo(function ComparisonPanel({ left, right }: { left: ExplorerObjectDetails | undefined; right: ExplorerObjectDetails | undefined }) {
  const closest = (object: ExplorerObjectDetails | undefined) => object ? closestApproach(object.approaches) : null;
  const rows = [
    { label: "Designation", value: (object: ExplorerObjectDetails | undefined) => object?.designation ?? "Data unavailable" },
    { label: "Diameter", value: (object: ExplorerObjectDetails | undefined) => formatDiameterRange(object?.estimatedDiameterMinKm ?? null, object?.estimatedDiameterMaxKm ?? null) },
    { label: "Hazardous", value: (object: ExplorerObjectDetails | undefined) => object ? threatLabel(object.hazardous) : "Data unavailable" },
    { label: "Absolute magnitude", value: (object: ExplorerObjectDetails | undefined) => formatValue(object?.absoluteMagnitude ?? null) },
    { label: "Orbital period", value: (object: ExplorerObjectDetails | undefined) => formatValue(object?.orbitalPeriodDays ?? null, " days") },
    { label: "Closest recorded Earth approach", value: (object: ExplorerObjectDetails | undefined) => object ? closest(object) ? formatCompact(closest(object)?.missDistanceKm ?? null, " km") : "No Earth close approach reported" : "Data unavailable" },
    { label: "Relative velocity at closest Earth approach", value: (object: ExplorerObjectDetails | undefined) => object ? closest(object) ? formatCompact(closest(object)?.relativeVelocityKph ?? null, " km/h") : "No Earth encounter to measure" : "Data unavailable" },
    { label: "Closest orbital proximity (Earth MOID)", value: (object: ExplorerObjectDetails | undefined) => object ? formatValue(object.earthMoidAu ?? null, " AU") : "Data unavailable" },
    { label: "Orbit class", value: (object: ExplorerObjectDetails | undefined) => object?.orbitalClass ?? "Data unavailable" },
  ];
  return <HUDPanel title="Object comparison" eyebrow="A / B matrix"><div className="grid gap-[var(--space-2)] sm:grid-cols-2"><div className="border border-[var(--color-line)] bg-[var(--color-panel)] px-[var(--space-2)] py-[var(--space-1)]"><p className="m-0 text-[0.5625rem] uppercase tracking-[0.12em] text-[var(--color-muted)]">OBJECT A</p><p className="m-0 mt-1 text-xs uppercase tracking-[0.08em] text-[var(--color-information)]">{left?.designation ?? "Awaiting selection"}</p></div><div className="border border-[var(--color-line)] bg-[var(--color-panel)] px-[var(--space-2)] py-[var(--space-1)]"><p className="m-0 text-[0.5625rem] uppercase tracking-[0.12em] text-[var(--color-muted)]">OBJECT B</p><p className="m-0 mt-1 text-xs uppercase tracking-[0.08em] text-[var(--color-information)]">{right?.designation ?? "Awaiting selection"}</p></div></div><div className="mt-[var(--space-2)] space-y-[var(--space-1)]">{rows.map((row) => <div key={row.label} className="grid grid-cols-1 gap-[var(--space-1)] border-b border-[var(--color-line)] pb-[var(--space-1)] text-[0.5625rem] uppercase tracking-[0.08em] sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]"><span className="text-[var(--color-muted)]">{row.label}</span><span className="break-words text-[var(--color-information)]">{row.value(left)}</span><span className="break-words text-[var(--color-primary)]">{row.value(right)}</span></div>)}</div></HUDPanel>;
});

export function ExplorerConsole() {
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [compareAId, setCompareAId] = useState<string | null>(null);
  const [compareBId, setCompareBId] = useState<string | null>(null);
  useEffect(() => { const timeout = window.setTimeout(() => setQuery(input), SEARCH_DEBOUNCE_MS); return () => window.clearTimeout(timeout); }, [input]);
  const search = useExplorerSearch(query);
  const details = useExplorerObject(selectedId);
  const compareLeft = useExplorerObject(compareAId);
  const compareRight = useExplorerObject(compareBId);
  const publishPageData = useSpaceAssistantPublisher();
  const isCurrentQuery = input.trim() === query.trim();
  const results = isCurrentQuery ? search.data?.results ?? [] : [];
  const selectedSummary = results.find((object) => object.id === selectedId);
  const compareLeftSummary = results.find((object) => object.id === compareAId);
  const compareRightSummary = results.find((object) => object.id === compareBId);
  const selectedDetails = useMemo(() => mergeObjectSummary(details.data, selectedSummary), [details.data, selectedSummary]);
  const compareLeftDetails = useMemo(() => mergeObjectSummary(compareLeft.data, compareLeftSummary), [compareLeft.data, compareLeftSummary]);
  const compareRightDetails = useMemo(() => mergeObjectSummary(compareRight.data, compareRightSummary), [compareRight.data, compareRightSummary]);
  useEffect(() => {
    publishPageData({
      page: "explorer",
      status: details.error ? "error" : details.isFetching ? "loading" : selectedDetails ? "ready" : "unavailable",
      error: details.error?.message,
      object: selectedDetails,
    });
  }, [details.error, details.isFetching, publishPageData, selectedDetails]);
  useEffect(() => {
    if (!isCurrentQuery || search.isFetching || search.error || results.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!results.some((object) => object.id === selectedId)) setSelectedId(results[0].id);
  }, [isCurrentQuery, results, search.error, search.isFetching, selectedId]);
  useEffect(() => {
    if (!results.length) return;
    if (!compareAId || !results.some((object) => object.id === compareAId)) setCompareAId(results[0].id);
    if (!compareBId || compareBId === compareAId || !results.some((object) => object.id === compareBId)) setCompareBId(results[1]?.id ?? results[0].id);
  }, [compareAId, compareBId, results]);
  const registryDetail = useMemo(() => input.trim().length < 1 ? "Default suggestions" : !isCurrentQuery || search.isFetching ? "Scanning registry" : `${results.length} matched`, [input, isCurrentQuery, results.length, search.isFetching]);
  const handleSelect = useCallback((id: string) => setSelectedId(id), []);
  const submitSearch = useCallback((event: React.FormEvent<HTMLFormElement>) => { event.preventDefault(); setQuery(input); }, [input]);

  return (
    <div className="space-y-[var(--space-4)]">
      <div>
        <p className="m-0 text-[0.625rem] uppercase tracking-[0.2em] text-[var(--color-accent)]">02 / Orbital Intelligence</p>
        <h1 className="m-0 mt-2 font-[var(--font-display)] text-3xl uppercase tracking-[0.08em]">Explorer Terminal</h1>
      </div>
      <HUDPanel title="Object search" eyebrow="Lookup / NASA registry">
        <form onSubmit={submitSearch} className="flex flex-col gap-[var(--space-1)] sm:flex-row">
          <input value={input} onChange={(event) => setInput(event.target.value)} aria-label="Search asteroid registry" placeholder="TARGET ACQUISITION / DESIGNATION OR NASA ID..." className="hud-input min-h-11 flex-1 border border-[var(--color-line)] px-[var(--space-2)] text-xs uppercase tracking-[0.12em] text-[var(--color-information)] outline-none placeholder:text-[var(--color-muted)] focus:border-[var(--color-primary)]" />
          <CommandButton type="submit">Acquire target</CommandButton>
        </form>
      </HUDPanel>
      <div className="grid gap-[var(--space-2)] lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="min-w-0">
          <SectionHeader index="//" title="Object registry" detail={registryDetail} />
          <div
            aria-label="Asteroid search results"
            aria-live="polite"
            className="mt-[var(--space-2)] max-h-[65vh] space-y-[var(--space-1)] overflow-y-auto overscroll-contain pr-1"
            role="region"
            tabIndex={0}
          >
            {query.trim().length < 1 && <p className="m-0 py-[var(--space-3)] text-xs uppercase tracking-[0.12em] text-[var(--color-muted)]">Default NEO suggestions<span className="terminal-cursor">_</span></p>}
            {search.isFetching && <p className="m-0 py-[var(--space-3)] text-xs uppercase tracking-[0.12em] text-[var(--color-muted)]">Scanning object registry<span className="terminal-cursor">_</span></p>}
            {search.error && <p className="m-0 py-[var(--space-3)] text-xs uppercase tracking-[0.12em] text-[var(--color-danger)]">{readableError(search.error)}</p>}
            {!search.isFetching && !search.error && search.data?.degraded && <p className="m-0 py-[var(--space-3)] text-xs uppercase tracking-[0.12em] text-[var(--color-danger)]">JPL catalog is reconnecting — showing saved matching results where available</p>}
            {!search.isFetching && !search.error && query.trim().length >= 1 && results.length === 0 && <p className="m-0 py-[var(--space-3)] text-xs uppercase tracking-[0.12em] text-[var(--color-muted)]">No target found in current NASA registry cache</p>}
            {results.map((object) => <SearchResult key={object.id} object={object} selected={selectedId === object.id} onSelect={handleSelect} />)}
          </div>
          {results.length > 0 && (
            <div className="mt-[var(--space-2)] space-y-[var(--space-1)]">
              <SectionHeader index="//" title="Comparison targets" detail="Select A / B" />
              <div className="grid gap-[var(--space-1)] sm:grid-cols-2">
                <label className="text-[0.5625rem] uppercase tracking-[0.12em] text-[var(--color-muted)]">
                  <span className="mb-1 block">Object A</span>
                  <select value={compareAId ?? ""} onChange={(event) => setCompareAId(event.target.value)} className="hud-input hud-select min-h-11 w-full border border-[var(--color-line)] bg-[var(--color-panel)] px-[var(--space-1)] py-[var(--space-1)] text-[0.625rem] uppercase tracking-[0.08em] text-[var(--color-information)] outline-none focus:border-[var(--color-primary)]">
                    <option value="">Select target</option>
                    {results.map((object) => <option key={`${object.id}-a`} value={object.id}>{object.designation}</option>)}
                  </select>
                </label>
                <label className="text-[0.5625rem] uppercase tracking-[0.12em] text-[var(--color-muted)]">
                  <span className="mb-1 block">Object B</span>
                  <select value={compareBId ?? ""} onChange={(event) => setCompareBId(event.target.value)} className="hud-input hud-select min-h-11 w-full border border-[var(--color-line)] bg-[var(--color-panel)] px-[var(--space-1)] py-[var(--space-1)] text-[0.625rem] uppercase tracking-[0.08em] text-[var(--color-information)] outline-none focus:border-[var(--color-primary)]">
                    <option value="">Select target</option>
                    {results.map((object) => <option key={`${object.id}-b`} value={object.id}>{object.designation}</option>)}
                  </select>
                </label>
              </div>
            </div>
          )}
          {results.length > 0 && <div className="mt-[var(--space-2)]"><ComparisonPanel left={compareLeftDetails} right={compareRightDetails} /></div>}
        </div>
        <ObjectDetailsPanel object={selectedDetails} loading={details.isFetching} error={details.error} />
      </div>
    </div>
  );
}
