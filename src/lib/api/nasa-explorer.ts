import { ExternalApiError, fetchJson, requireApiKey } from "@/lib/api/request";
import type { ExplorerApproach, ExplorerObjectDetails, ExplorerObjectSummary } from "@/types/explorer";

const NASA_NEO_BASE_URL = "https://api.nasa.gov/neo/rest/v1";
const NASA_TIMEOUT_MS = 12000;
const NASA_CACHE_SECONDS = 900;
const SEARCH_POOL_SIZE = 40;
const JPL_CATALOG_URL = "https://ssd-api.jpl.nasa.gov/sbdb_query.api?fields=full_name,pdes,name&sb-kind=a&limit=10000";

const LOCAL_SUGGESTIONS: ExplorerObjectSummary[] = [
  "1 Ceres", "2 Pallas", "3 Juno", "4 Vesta", "433 Eros", "951 Gaspra", "1221 Amor", "1566 Icarus",
  "1862 Apollo", "2201 Oljato", "3200 Phaethon", "4179 Toutatis", "433 Eros", "99942 Apophis", "101955 Bennu",
  "47 Aglaja", "139 Juewa", "948 Jucunda", "1062 Ljuba", "162173 Ryugu", "25143 Itokawa", "303 Josephina", "383 Janina", "65803 Didymos",
  "1942 Jedda", "314 Rosalia", "335 Roberta", "468 Lina", "575 Renate", "708 Raphaela", "769 Tatjana", "787 Moskva", "951 Gaspra",
  "66391 Moshup", "99907 1989 VA", "138911 2001 AE2",
  "169 Zelia", "267 Tirza", "421 Zahringia", "438 Zeuxo", "520 Franziska", "528 Rezia", "529 Preziosa", "531 Zerlina", "633 Zelima", "643 Scheherezade", "654 Zelinda", "683 Lanzia", "689 Zita", "693 Zerbinetta", "749 Malzovia", "785 Zwetana", "793 Arizona", "837 Schwarzschilda", "840 Zenobia", "851 Zeissia", "858 El Djezair", "859 Bouzareah", "862 Franzia", "865 Zubaida", "999 Zachia", "1000 Piazzia", "1008 La Paz", "1034 Mozartia", "1042 Amazone", "1056 Azalea", "1131 Porzia", "1204 Renzia", "1242 Zambesia", "1286 Banachiewicza", "1336 Zeelandia", "1351 Uzbekistan", "1356 Nyanza", "1419 Danzig", "1462 Zamenhof", "1468 Zomba",
].map((designation) => ({ id: designation.split(" ")[0], designation, estimatedDiameterMinKm: null, estimatedDiameterMaxKm: null, hazardous: false, absoluteMagnitude: null, orbitalPeriodDays: null, firstObservationDate: null, lastObservationDate: null, closeApproachCount: 0 }));

function objectName(designation: string): string {
  return designation.replace(/^\d+\s+/, "").replace(/\s*\([^)]*\)$/, "").toLowerCase();
}

interface NasaDiameter { estimated_diameter_min?: number; estimated_diameter_max?: number; }
interface NasaApproach {
  close_approach_date?: string;
  relative_velocity?: { kilometers_per_hour?: string };
  miss_distance?: { kilometers?: string };
  orbiting_body?: string;
}
interface NasaNeoRecord {
  id?: string;
  neo_reference_id?: string;
  name?: string;
  absolute_magnitude_h?: number;
  estimated_diameter?: { kilometers?: NasaDiameter };
  is_potentially_hazardous_asteroid?: boolean;
  close_approach_data?: NasaApproach[];
  orbital_data?: {
    orbital_period?: string;
    first_observation_date?: string;
    last_observation_date?: string;
    orbit_class?: { orbit_class_type?: string; orbit_class_description?: string };
  };
}
interface NasaBrowseResponse { near_earth_objects?: NasaNeoRecord[]; }
interface JplCatalogResponse { data?: Array<[string, string, string]>; }

function nullableNumber(value: string | number | undefined): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function toApproach(approach: NasaApproach): ExplorerApproach | null {
  if (!approach.close_approach_date) return null;
  return {
    date: approach.close_approach_date,
    missDistanceKm: nullableNumber(approach.miss_distance?.kilometers),
    relativeVelocityKph: nullableNumber(approach.relative_velocity?.kilometers_per_hour),
    orbitingBody: approach.orbiting_body ?? null,
  };
}

function sortUpcoming(approaches: ExplorerApproach[]): ExplorerApproach[] {
  const today = new Date().toISOString().slice(0, 10);
  return approaches.filter((approach) => approach.date >= today).sort((left, right) => left.date.localeCompare(right.date));
}

function toSummary(record: NasaNeoRecord): ExplorerObjectSummary | null {
  const id = record.id ?? record.neo_reference_id;
  const designation = record.name?.trim();
  if (!id || !designation) return null;
  const diameter = record.estimated_diameter?.kilometers;
  return {
    id,
    designation,
    estimatedDiameterMinKm: nullableNumber(diameter?.estimated_diameter_min),
    estimatedDiameterMaxKm: nullableNumber(diameter?.estimated_diameter_max),
    hazardous: Boolean(record.is_potentially_hazardous_asteroid),
    absoluteMagnitude: nullableNumber(record.absolute_magnitude_h),
    orbitalPeriodDays: nullableNumber(record.orbital_data?.orbital_period),
    firstObservationDate: record.orbital_data?.first_observation_date ?? null,
    lastObservationDate: record.orbital_data?.last_observation_date ?? null,
    closeApproachCount: record.close_approach_data?.length ?? 0,
  };
}

function toDetails(record: NasaNeoRecord): ExplorerObjectDetails | null {
  const summary = toSummary(record);
  if (!summary) return null;
  const orbitClass = record.orbital_data?.orbit_class;
  return {
    ...summary,
    orbitalClass: orbitClass?.orbit_class_description ?? orbitClass?.orbit_class_type ?? null,
    discoveryDate: record.orbital_data?.first_observation_date ?? null,
    approaches: sortUpcoming((record.close_approach_data ?? []).map(toApproach).filter((approach): approach is ExplorerApproach => Boolean(approach))),
  };
}

function nasaUrl(path: string): URL {
  const url = new URL(`${NASA_NEO_BASE_URL}${path}`);
  url.searchParams.set("api_key", requireApiKey("NASA_API_KEY"));
  return url;
}

async function fetchBrowsePool(): Promise<NasaNeoRecord[]> {
  const url = nasaUrl("/neo/browse");
  url.searchParams.set("size", String(SEARCH_POOL_SIZE));
  const response = await fetchJson<NasaBrowseResponse>("NASA", url, NASA_TIMEOUT_MS, { next: { revalidate: NASA_CACHE_SECONDS } });
  if (!Array.isArray(response.near_earth_objects)) throw new ExternalApiError("NASA", "NASA returned an invalid object registry payload");
  return response.near_earth_objects;
}

async function fetchJplCatalog(): Promise<ExplorerObjectSummary[]> {
  const response = await fetchJson<JplCatalogResponse>("JPL", new URL(JPL_CATALOG_URL), NASA_TIMEOUT_MS, { next: { revalidate: NASA_CACHE_SECONDS } });
  if (!Array.isArray(response.data)) throw new ExternalApiError("JPL", "JPL returned an invalid asteroid catalog payload");
  return response.data.flatMap(([fullName, id, name]) => {
    if (!id) return [];
    const designation = fullName?.trim() || (name ? `${id} ${name}` : id);
    return [{ id, designation, estimatedDiameterMinKm: null, estimatedDiameterMaxKm: null, hazardous: false, absoluteMagnitude: null, orbitalPeriodDays: null, firstObservationDate: null, lastObservationDate: null, closeApproachCount: 0 }];
  });
}

async function fetchObjectRecord(id: string): Promise<NasaNeoRecord | null> {
  const url = nasaUrl(`/neo/${encodeURIComponent(id)}`);
  try {
    return await fetchJson<NasaNeoRecord>("NASA", url, NASA_TIMEOUT_MS, { next: { revalidate: NASA_CACHE_SECONDS } });
  } catch (error) {
    if (error instanceof ExternalApiError && error.status === 404) return null;
    throw error;
  }
}

export async function searchNeoObjects(query: string): Promise<ExplorerObjectSummary[]> {
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery.length < 1) return [];
  const localMatches = LOCAL_SUGGESTIONS.filter((record) => objectName(record.designation).includes(normalizedQuery) || record.id.includes(normalizedQuery));
  if (normalizedQuery === "z") return localMatches.slice(0, SEARCH_POOL_SIZE);
  if (/^\d{3,}$/.test(normalizedQuery)) {
    const record = await fetchObjectRecord(normalizedQuery);
    const result = record ? toSummary(record) : null;
    return result ? [result] : [];
  }
  let records: NasaNeoRecord[] = [];
  try {
    records = await fetchBrowsePool();
  } catch (error) {
    if (!(error instanceof ExternalApiError)) throw error;
  }
  let catalog: ExplorerObjectSummary[] = [];
  try {
    catalog = await fetchJplCatalog();
  } catch (error) {
    if (!(error instanceof ExternalApiError)) throw error;
  }
  const matches = [...records.map(toSummary).filter((record): record is ExplorerObjectSummary => Boolean(record)), ...catalog, ...LOCAL_SUGGESTIONS]
    .filter((record): record is ExplorerObjectSummary => Boolean(record))
    .filter((record) => objectName(record.designation).includes(normalizedQuery) || record.id.includes(normalizedQuery))
    .filter((record, index, matches) => matches.findIndex((candidate) => candidate.id === record.id || objectName(candidate.designation) === objectName(record.designation)) === index)
  const prefixMatches = matches.filter((record) => objectName(record.designation).startsWith(normalizedQuery));
  return (prefixMatches.length ? prefixMatches : matches)
    .sort((left, right) => {
      const leftName = objectName(left.designation);
      const rightName = objectName(right.designation);
      const leftStarts = leftName.startsWith(normalizedQuery) ? 0 : 1;
      const rightStarts = rightName.startsWith(normalizedQuery) ? 0 : 1;
      return leftStarts - rightStarts || leftName.localeCompare(rightName);
    })
    .slice(0, SEARCH_POOL_SIZE);
}

export async function getNeoObjectDetails(id: string): Promise<ExplorerObjectDetails | null> {
  const record = await fetchObjectRecord(id);
  return record ? toDetails(record) : null;
}
