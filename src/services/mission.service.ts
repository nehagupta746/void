import { fetchActiveSatellites } from "@/lib/api/celestrak";
import { fetchIssPosition } from "@/lib/api/iss";
import { fetchCloseApproaches } from "@/lib/api/nasa";
import { verifyN2yoConnection } from "@/lib/api/n2yo";
import { CelestrakCatalogResult } from "@/lib/api/celestrak";
import { CloseApproach, MissionSnapshot, ServiceHealth } from "@/types/mission";

function messageFor(error: unknown): string { return error instanceof Error ? error.message : "Unknown source failure"; }
function riskScore(approaches: CloseApproach[]): number { return approaches.reduce((score, approach) => score + (approach.risk === "high" ? 50 : approach.risk === "elevated" ? 20 : 5), 0); }
function displaySourceError(source: SourceName, message: string): string {
  if (source === "nasa" && message.includes("429")) return "NASA rate limit reached; showing fallback approaches";
  if (source === "n2yo" && message.includes("undefined")) return "N2YO key missing; pass predictions unavailable";
  if (source === "celestrak") return "CelesTrak is synchronizing; showing fallback catalog";
  return `${source.toUpperCase()} data delayed`;
}
const fallbackSatellites = [
  [25544, "ISS (ZARYA)"], [20580, "HUBBLE SPACE TELESCOPE"], [48274, "CSS (TIANHE)"], [43013, "NOAA 20"],
  [33591, "NOAA 19"], [39084, "METEOR-M 2"], [28654, "AQUA"], [27424, "TERRA"], [37849, "LANDSAT 8"],
  [25994, "TERRA SAR-X"], [25682, "IRIDIUM 5"], [40967, "SENTINEL-2A"],
].map(([noradId, name]) => ({ id: String(noradId), name: String(name), noradId: Number(noradId), altitudeKm: null, inclination: 0 }));
function fallbackApproaches(): CloseApproach[] {
  const date = new Date().toISOString().slice(0, 10);
  return [
    ["fallback-2013-oy3", "(2013 OY3)", 16600000, 24200], ["fallback-2019-lv", "(2019 LV)", 35700000, 15800],
    ["fallback-2018-tp", "(2018 TP)", 47800000, 37900], ["fallback-2014-dv110", "(2014 DV110)", 62400000, 51800],
    ["fallback-2020-bj6", "(2020 BJ6)", 62500000, 23600],
  ].map(([id, name, distanceKm, relativeVelocityKph]) => ({ id: String(id), name: String(name), date, distanceKm: Number(distanceKm), relativeVelocityKph: Number(relativeVelocityKph), risk: "low" as const }));
}
type SourceName = "nasa" | "n2yo" | "celestrak" | "iss";
type MeasuredResult<T> = { data: T; latencyMs: number } | { error: string; latencyMs: number };

async function measure<T>(request: () => Promise<T>): Promise<MeasuredResult<T>> {
  const startedAt = performance.now();
  try { return { data: await request(), latencyMs: Math.round(performance.now() - startedAt) }; }
  catch (error) { return { error: messageFor(error), latencyMs: Math.round(performance.now() - startedAt) }; }
}
async function measureWithDeadline<T>(request: () => Promise<T>, deadlineMs: number, source: string): Promise<MeasuredResult<T>> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      measure(request),
      new Promise<MeasuredResult<T>>((resolve) => { timeout = setTimeout(() => resolve({ error: `${source} is synchronizing in the background`, latencyMs: deadlineMs }), deadlineMs); }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
function isSuccess<T>(result: MeasuredResult<T>): result is { data: T; latencyMs: number } { return "data" in result; }
function healthFor<T>(result: MeasuredResult<T>, cached = false): ServiceHealth { return cached ? "degraded" : !isSuccess(result) ? "offline" : "connected"; }
function overallHealth(services: Record<SourceName, ServiceHealth>): MissionSnapshot["connection"] {
  const values = Object.values(services);
  const offlineCount = values.filter((health) => health === "offline").length;
  if (offlineCount === values.length) return "offline";
  if (offlineCount >= 2) return "degraded";
  if (offlineCount === 1 || values.includes("degraded")) return "delayed";
  return "live";
}

export async function getMissionSnapshot(): Promise<MissionSnapshot> {
  const [celestrakResult, approachesResult, issResult, n2yoResult] = await Promise.all([measureWithDeadline(fetchActiveSatellites, 4500, "CelesTrak"), measure(fetchCloseApproaches), measure(fetchIssPosition), measure(verifyN2yoConnection)]);
  const celestrakData: CelestrakCatalogResult | null = isSuccess(celestrakResult) ? celestrakResult.data : null;
  const serviceErrors = {
    celestrak: celestrakData?.cached ? "CelesTrak unavailable (cached data)" : !isSuccess(celestrakResult) ? celestrakResult.error : undefined,
    nasa: !isSuccess(approachesResult) ? approachesResult.error : undefined,
    iss: !isSuccess(issResult) ? issResult.error : undefined,
    n2yo: !isSuccess(n2yoResult) ? n2yoResult.error : undefined,
  };
  const sourceErrors = (Object.entries(serviceErrors) as Array<[SourceName, string | undefined]>).flatMap(([source, message]) => message ? [displaySourceError(source, message)] : []);
  const satellites = celestrakData?.satellites ?? fallbackSatellites;
  const closeApproaches = isSuccess(approachesResult) ? approachesResult.data : fallbackApproaches();
  const iss = isSuccess(issResult) ? issResult.data : null;
  const services = { celestrak: healthFor(celestrakResult, celestrakData?.cached ?? true), nasa: healthFor(approachesResult, !isSuccess(approachesResult)), iss: healthFor(issResult), n2yo: healthFor(n2yoResult) };
  const connection = overallHealth(services);
  const hazardIndex = riskScore(closeApproaches);
  const hazardLevel = closeApproaches.some((approach) => approach.risk === "high") ? "high" : closeApproaches.some((approach) => approach.risk === "elevated") ? "elevated" : "low";
  const successfulLatencies = [
    ...(isSuccess(celestrakResult) && !celestrakData?.cached ? [celestrakResult.latencyMs] : []),
    ...(isSuccess(approachesResult) ? [approachesResult.latencyMs] : []),
    ...(isSuccess(issResult) ? [issResult.latencyMs] : []),
    ...(isSuccess(n2yoResult) ? [n2yoResult.latencyMs] : []),
  ];
  const latencyMs = successfulLatencies.length ? Math.round(successfulLatencies.reduce((total, latency) => total + latency, 0) / successfulLatencies.length) : null;
  return {
    satellites,
    closeApproaches,
    iss,
    telemetry: { trackedObjects: satellites.length, closeApproaches: closeApproaches.length, hazardIndex, hazardLevel, latencyMs },
    connection,
    services,
    serviceErrors,
    sourceLatencyMs: { celestrak: celestrakResult.latencyMs, nasa: approachesResult.latencyMs, iss: issResult.latencyMs, n2yo: n2yoResult.latencyMs },
    updatedAt: new Date().toISOString(),
    sourceErrors,
  };
}
