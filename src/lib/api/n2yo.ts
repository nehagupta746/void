import { ExternalApiError, fetchJson, requireApiKey } from "@/lib/api/request";
import type { IssPass } from "@/types/iss";
import * as satellite from "satellite.js";

interface N2yoHealthResponse { info?: { category?: string }; }
interface N2yoTleResponse { tle?: string; }
interface N2yoPassResponse { passes?: Array<{ startUTC?: number; duration?: number; maxEl?: number; startAzCompass?: string; endAzCompass?: string }>; }
interface PublicTleResponse { line1?: string; line2?: string; }
const ISS_NORAD_ID = 25544;
const PASS_DAYS = 2;
const MIN_ELEVATION_DEGREES = 10;
const TLE_URL = "https://tle.ivanstanojevic.me/api/tle/25544";

function n2yoUrl(path: string): URL {
  const url = new URL(`https://api.n2yo.com/rest/v1/satellite/${path}`);
  url.searchParams.set("apiKey", requireApiKey("N2YO_API_KEY"));
  return url;
}

export async function verifyN2yoConnection(): Promise<void> {
  const payload = await fetchJson<N2yoHealthResponse>("N2YO", n2yoUrl("above/0/0/0/10/18/"), 12000, { next: { revalidate: 600 } });
  if (!payload.info) throw new ExternalApiError("N2YO", "N2YO returned an invalid health payload");
}

export async function fetchIssTleOrbitNumber(): Promise<number | null> {
  const payload = await fetchJson<N2yoTleResponse>("N2YO", n2yoUrl(`tle/${ISS_NORAD_ID}`), 12000, { next: { revalidate: 1800 } });
  const lineTwo = payload.tle?.split(/\r?\n/)[1];
  const orbitNumber = Number(lineTwo?.slice(63, 68).trim());
  return Number.isInteger(orbitNumber) ? orbitNumber : null;
}

export async function fetchIssPasses(latitude: number, longitude: number): Promise<IssPass[]> {
  const path = `radiopasses/${ISS_NORAD_ID}/${latitude}/${longitude}/0/${PASS_DAYS}/${MIN_ELEVATION_DEGREES}/`;
  const payload = await fetchJson<N2yoPassResponse>("N2YO", n2yoUrl(path), 12000, { next: { revalidate: 300 } });
  if (!Array.isArray(payload.passes)) throw new ExternalApiError("N2YO", "N2YO returned an invalid ISS pass payload");
  return payload.passes.flatMap((pass) => {
    if (!Number.isFinite(pass.startUTC) || !Number.isFinite(pass.duration) || !Number.isFinite(pass.maxEl)) return [];
    return [{ startTime: new Date(pass.startUTC! * 1000).toISOString(), durationSeconds: pass.duration!, maxElevationDegrees: pass.maxEl!, riseDirection: pass.startAzCompass ?? "Unknown", setDirection: pass.endAzCompass ?? "Unknown" }];
  });
}

async function fetchPublicTle(): Promise<PublicTleResponse> {
  return fetchJson<PublicTleResponse>("ISS TLE", new URL(TLE_URL), 8000, { next: { revalidate: 1800 } });
}

export async function estimateIssPasses(latitude: number, longitude: number): Promise<IssPass[]> {
  const tle = await fetchPublicTle();
  if (!tle.line1 || !tle.line2) throw new ExternalApiError("ISS TLE", "ISS TLE source returned an invalid payload");
  const satrec = satellite.twoline2satrec(tle.line1, tle.line2);
  const observer = { latitude: satellite.degreesToRadians(latitude), longitude: satellite.degreesToRadians(longitude), height: 0 };
  const passes: IssPass[] = [];
  let active: { startTime: Date; startDirection: string; maxElevation: number; lastTime: Date; endDirection: string } | null = null;
  const now = Date.now();
  for (let offset = 0; offset <= 48 * 60 * 60 * 1000; offset += 60000) {
    const timestamp = new Date(now + offset);
    const propagated = satellite.propagate(satrec, timestamp);
    if (!propagated || typeof propagated.position === "boolean") continue;
    const gmst = satellite.gstime(timestamp);
    const ecf = satellite.eciToEcf(propagated.position, gmst);
    const look = satellite.ecfToLookAngles(observer, ecf);
    const elevation = satellite.radiansToDegrees(look.elevation);
    const direction = satellite.radiansToDegrees(look.azimuth);
    const compass = `${Math.round(direction)}°`;
    if (elevation >= MIN_ELEVATION_DEGREES) {
      if (!active) active = { startTime: timestamp, startDirection: compass, maxElevation: elevation, lastTime: timestamp, endDirection: compass };
      active.maxElevation = Math.max(active.maxElevation, elevation);
      active.lastTime = timestamp;
      active.endDirection = compass;
    } else if (active) {
      passes.push({ startTime: active.startTime.toISOString(), durationSeconds: (active.lastTime.getTime() - active.startTime.getTime()) / 1000, maxElevationDegrees: active.maxElevation, riseDirection: active.startDirection, setDirection: active.endDirection });
      active = null;
      if (passes.length >= 5) break;
    }
  }
  return passes;
}
