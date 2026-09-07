"use client";

import { HUDPanel } from "@/components/ui/HUDPanel";
import { useMissionSnapshot } from "@/hooks/useMissionSnapshot";

const numberFormatter = new Intl.NumberFormat("en", { maximumFractionDigits: 2 });
const sourceLabels = { nasa: "NASA / NEO", n2yo: "N2YO / Orbit", celestrak: "CelesTrak / Catalog", iss: "ISS / Position" } as const;

function value(number: number | null | undefined, suffix = ""): string { return number === null || number === undefined ? "--" : `${numberFormatter.format(number)}${suffix}`; }

export function MissionSnapshotPanel() {
  const { data, loading } = useMissionSnapshot();
  return <HUDPanel title="Mission snapshot" eyebrow="System / Live channels"><div className="grid gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
    <div><p className="m-0 text-[0.5625rem] uppercase tracking-[0.15em] text-[var(--color-muted)]">ISS latitude</p><p className="m-0 mt-1 text-sm text-[var(--color-information)]">{loading ? "Syncing..." : value(data?.iss?.latitude, "°")}</p></div>
    <div><p className="m-0 text-[0.5625rem] uppercase tracking-[0.15em] text-[var(--color-muted)]">ISS longitude</p><p className="m-0 mt-1 text-sm text-[var(--color-information)]">{loading ? "Syncing..." : value(data?.iss?.longitude, "°")}</p></div>
    <div><p className="m-0 text-[0.5625rem] uppercase tracking-[0.15em] text-[var(--color-muted)]">Altitude / velocity</p><p className="m-0 mt-1 text-sm text-[var(--color-information)]">{loading ? "Syncing..." : `${value(data?.iss?.altitudeKm, " km")} / ${value(data?.iss?.velocityKph, " km/h")}`}</p></div>
    <div><p className="m-0 text-[0.5625rem] uppercase tracking-[0.15em] text-[var(--color-muted)]">Catalog coverage</p><p className="m-0 mt-1 text-sm text-[var(--color-information)]">{loading ? "Syncing..." : `${value(data?.satellites.length)} tracked objects`}</p></div>
  </div><div className="mt-4 grid gap-2 border-t border-[var(--color-line)] pt-3 sm:grid-cols-2 lg:grid-cols-4">{(Object.keys(sourceLabels) as Array<keyof typeof sourceLabels>).map((source) => <div key={source} className="flex items-center justify-between gap-2 text-[0.625rem] uppercase tracking-[0.08em]"><span className="text-[var(--color-muted)]">{sourceLabels[source]}</span><span className={data?.services[source] === "connected" ? "text-[var(--color-signal)]" : "text-[var(--color-accent)]"}>{loading ? "sync" : data?.services[source] ?? "--"}</span></div>)}</div>{data?.sourceErrors.length ? <p className="m-0 mt-3 border-t border-[var(--color-line)] pt-3 text-[0.5625rem] uppercase tracking-[0.1em] text-[var(--color-accent)]">{data.sourceErrors.join(" / ")}</p> : null}</HUDPanel>;
}