import { CloseApproach, NasaFeedResponse, NasaNeo } from "@/types/mission";
import { ExternalApiError, fetchJson, requireApiKey } from "@/lib/api/request";

const NASA_NEO_URL = "https://api.nasa.gov/neo/rest/v1/feed";
const JPL_CAD_URL = "https://ssd-api.jpl.nasa.gov/cad.api";

function dateKey(date: Date): string { return date.toISOString().slice(0, 10); }

function toRisk(neo: NasaNeo, distanceKm: number): CloseApproach["risk"] {
  if (neo.is_potentially_hazardous_asteroid && distanceKm < 750000) return "high";
  if (neo.is_potentially_hazardous_asteroid || distanceKm < 2000000) return "elevated";
  return "low";
}

function distanceRisk(distanceKm: number): CloseApproach["risk"] { return distanceKm < 750000 ? "high" : distanceKm < 2000000 ? "elevated" : "low"; }
function cadDate(value: string): string | null { const match = value.match(/^(\d{4})-([A-Za-z]{3})-(\d{2})/); if (!match) return null; const months: Record<string, string> = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06", Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" }; return months[match[2]] ? `${match[1]}-${months[match[2]]}-${match[3]}` : null; }

export async function fetchCloseApproaches(): Promise<CloseApproach[]> {
  const apiKey = requireApiKey("NASA_API_KEY");
  const today = new Date();
  const endDate = new Date(today);
  endDate.setUTCDate(today.getUTCDate() + 7);
  const url = new URL(NASA_NEO_URL);
  url.searchParams.set("start_date", dateKey(today));
  url.searchParams.set("end_date", dateKey(endDate));
  url.searchParams.set("api_key", apiKey);
  try {
    const payload = await fetchJson<NasaFeedResponse>("NASA", url, 12000, { next: { revalidate: 300 } });
    if (!payload.near_earth_objects || typeof payload.near_earth_objects !== "object") throw new ExternalApiError("NASA", "NASA returned an invalid NEO payload");
    return Object.values(payload.near_earth_objects).flat().flatMap((neo) => {
      const approach = neo.close_approach_data[0];
      if (!approach) return [];
      const distanceKm = Number(approach.miss_distance.kilometers);
      const relativeVelocityKph = Number(approach.relative_velocity.kilometers_per_hour);
      return [{ id: neo.id, name: neo.name, date: approach.close_approach_date, distanceKm, relativeVelocityKph, risk: toRisk(neo, distanceKm) }];
    }).filter((approach) => Number.isFinite(approach.distanceKm)).sort((a, b) => a.distanceKm - b.distanceKm).slice(0, 5);
  } catch (error) {
    const cadUrl = new URL(JPL_CAD_URL);
    cadUrl.searchParams.set("date-min", dateKey(today));
    cadUrl.searchParams.set("date-max", dateKey(endDate));
    cadUrl.searchParams.set("dist-max", "0.05");
    const cad = await fetchJson<{ fields?: string[]; data?: Array<Array<string>> }>("JPL CAD", cadUrl, 12000, { next: { revalidate: 300 } });
    if (!Array.isArray(cad.fields) || !Array.isArray(cad.data)) throw error;
    const index = new Map(cad.fields.map((field, fieldIndex) => [field, fieldIndex]));
    return cad.data.flatMap((row) => {
      const date = cadDate(row[index.get("cd") ?? -1] ?? "");
      const distanceKm = Number(row[index.get("dist") ?? -1]);
      const relativeVelocityKph = Number(row[index.get("v_rel") ?? -1]) * 3600;
      if (!date || !Number.isFinite(distanceKm) || !Number.isFinite(relativeVelocityKph)) return [];
      const designation = row[index.get("des") ?? -1] ?? "Unknown object";
      return [{ id: `jpl-${designation}-${date}`, name: row[index.get("fullname") ?? -1] || `(${designation})`, date, distanceKm: distanceKm * 149597870.7, relativeVelocityKph, risk: distanceRisk(distanceKm * 149597870.7) }];
    }).sort((a, b) => a.distanceKm - b.distanceKm).slice(0, 5);
  }
}
