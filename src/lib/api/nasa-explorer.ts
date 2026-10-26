import { ExternalApiError, fetchJson, requireApiKey } from "@/lib/api/request";
import type { ExplorerApproach, ExplorerObjectDetails, ExplorerObjectSummary, ExplorerSearchResponse } from "@/types/explorer";

const NASA_NEO_BASE_URL = "https://api.nasa.gov/neo/rest/v1";
const NASA_TIMEOUT_MS = 12000;
const JPL_SEARCH_TIMEOUT_MS = 20000;
const NASA_CACHE_SECONDS = 900;
const SEARCH_POOL_SIZE = 40;
const CATALOG_SEARCH_CACHE_MS = 15 * 60 * 1000;
const JPL_APPROACH_FORECAST_YEARS = 100;
const JPL_CATALOG_URL = "https://ssd-api.jpl.nasa.gov/sbdb_query.api";
const JPL_CAD_URL = "https://ssd-api.jpl.nasa.gov/cad.api";
const REFERENCE_EXPLORER_URL = "https://aster-eosin.vercel.app";
const LOCAL_NEO_IDS = new Set(["433", "1221", "1566", "1862", "2201", "3200", "4179", "99942", "101955", "162173", "25143", "65803", "66391", "99907", "138911"]);
const OBJECT_NAME_COLLATOR = new Intl.Collator("en", { sensitivity: "base", ignorePunctuation: true });
const catalogSearchCache = new Map<string, { records: ExplorerObjectSummary[]; expiresAt: number }>();
const catalogSearchRequests = new Map<string, Promise<ExplorerObjectSummary[]>>();

const LOCAL_SUGGESTIONS: ExplorerObjectSummary[] = [
  "1 Ceres", "2 Pallas", "3 Juno", "4 Vesta", "433 Eros", "951 Gaspra", "1221 Amor", "1566 Icarus",
  "1862 Apollo", "2201 Oljato", "3200 Phaethon", "4179 Toutatis", "433 Eros", "99942 Apophis", "101955 Bennu",
  "47 Aglaja", "139 Juewa", "948 Jucunda", "1062 Ljuba", "162173 Ryugu", "25143 Itokawa", "303 Josephina", "383 Janina", "65803 Didymos",
  "1942 Jedda", "314 Rosalia", "335 Roberta", "468 Lina", "575 Renate", "708 Raphaela", "769 Tatjana", "787 Moskva", "951 Gaspra",
  "66391 Moshup", "99907 1989 VA", "138911 2001 AE2",
  "169 Zelia", "267 Tirza", "421 Zahringia", "438 Zeuxo", "520 Franziska", "528 Rezia", "529 Preziosa", "531 Zerlina", "633 Zelima", "643 Scheherezade", "654 Zelinda", "683 Lanzia", "689 Zita", "693 Zerbinetta", "749 Malzovia", "785 Zwetana", "793 Arizona", "837 Schwarzschilda", "840 Zenobia", "851 Zeissia", "858 El Djezair", "859 Bouzareah", "862 Franzia", "865 Zubaida", "999 Zachia", "1000 Piazzia", "1008 La Paz", "1034 Mozartia", "1042 Amazone", "1056 Azalea", "1131 Porzia", "1204 Renzia", "1242 Zambesia", "1286 Banachiewicza", "1336 Zeelandia", "1351 Uzbekistan", "1356 Nyanza", "1419 Danzig", "1462 Zamenhof", "1468 Zomba",
].map((designation) => {
  const id = designation.split(" ")[0];
  return { id, nasaId: null, designation, estimatedDiameterMinKm: null, estimatedDiameterMaxKm: null, hazardous: null, absoluteMagnitude: null, orbitalPeriodDays: null, isNearEarthObject: LOCAL_NEO_IDS.has(id), firstObservationDate: null, lastObservationDate: null, closeApproachCount: 0 };
});

const DEFAULT_SEARCH_SUGGESTIONS = LOCAL_SUGGESTIONS
  .filter((record) => ["99942", "101955", "65803", "433", "25143", "3200", "162173", "4179"].includes(record.id))
  .sort((left, right) => OBJECT_NAME_COLLATOR.compare(objectName(left.designation), objectName(right.designation)));

function objectName(designation: string): string {
  const name = designation.replace(/^\d+\s+/, "").replace(/\s*\([^)]*\)$/, "").trim();
  return (name || designation.trim()).toLowerCase();
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
    semi_major_axis?: string;
    eccentricity?: string;
    inclination?: string;
    perihelion_distance?: string;
    minimum_orbit_intersection?: string;
  };
}
interface JplCatalogResponse { fields?: string[]; data?: Array<Array<string | null>>; }
interface JplObjectResponse {
  object?: { des?: string; fullname?: string; name?: string; pha?: boolean; neo?: boolean; orbit_class?: { name?: string; code?: string } };
  phys_par?: Array<{ name?: string; value?: number | string }>;
  orbit?: {
    first_obs?: string;
    last_obs?: string;
    class?: { name?: string; code?: string };
    elements?: Array<{ name?: string; value?: number | string }>;
  };
}
interface ReferenceObjectResponse { object?: ExplorerObjectDetails | null; }

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

function sortApproaches(approaches: ExplorerApproach[]): ExplorerApproach[] {
  return approaches.sort((left, right) => left.date.localeCompare(right.date));
}

function toSummary(record: NasaNeoRecord): ExplorerObjectSummary | null {
  const id = record.neo_reference_id ?? record.id;
  const designation = record.name?.trim();
  if (!id || !designation) return null;
  const diameter = record.estimated_diameter?.kilometers;
  return {
    id,
    nasaId: record.neo_reference_id ?? id,
    designation,
    estimatedDiameterMinKm: nullableNumber(diameter?.estimated_diameter_min),
    estimatedDiameterMaxKm: nullableNumber(diameter?.estimated_diameter_max),
    hazardous: typeof record.is_potentially_hazardous_asteroid === "boolean" ? record.is_potentially_hazardous_asteroid : null,
    absoluteMagnitude: nullableNumber(record.absolute_magnitude_h),
    orbitalPeriodDays: nullableNumber(record.orbital_data?.orbital_period),
    orbitalClass: record.orbital_data?.orbit_class?.orbit_class_description ?? record.orbital_data?.orbit_class?.orbit_class_type ?? null,
    orbitalClassCode: record.orbital_data?.orbit_class?.orbit_class_type ?? null,
    semiMajorAxisAu: nullableNumber(record.orbital_data?.semi_major_axis),
    eccentricity: nullableNumber(record.orbital_data?.eccentricity),
    inclinationDegrees: nullableNumber(record.orbital_data?.inclination),
    perihelionDistanceAu: nullableNumber(record.orbital_data?.perihelion_distance),
    earthMoidAu: nullableNumber(record.orbital_data?.minimum_orbit_intersection),
    isNearEarthObject: true,
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
    orbitalClassCode: orbitClass?.orbit_class_type ?? null,
    discoveryDate: record.orbital_data?.first_observation_date ?? null,
    approaches: sortApproaches((record.close_approach_data ?? []).map(toApproach).filter((approach): approach is ExplorerApproach => Boolean(approach))),
  };
}

function nasaUrl(path: string): URL {
  const url = new URL(`${NASA_NEO_BASE_URL}${path}`);
  url.searchParams.set("api_key", requireApiKey("NASA_API_KEY"));
  return url;
}

async function fetchJplCatalog(query: string, includeProvisionalDesignations = false, matchNamePrefix = false): Promise<ExplorerObjectSummary[]> {
  const url = new URL(JPL_CATALOG_URL);
  url.searchParams.set("fields", "full_name,pdes,name,diameter,neo,pha,H,per,a,e,i,q,moid,first_obs,last_obs,class");
  url.searchParams.set("sb-kind", "a");
  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const namePattern = matchNamePrefix ? `^${escapedQuery}.*` : `.*${escapedQuery}.*`;
  url.searchParams.set("sb-cdata", JSON.stringify({
    [includeProvisionalDesignations ? "OR" : "AND"]: includeProvisionalDesignations
      ? [`name|RE|${namePattern}`, `pdes|RE|.*${escapedQuery}.*`]
      : [`name|RE|${namePattern}`],
  }));
  url.searchParams.set("sort", "name,pdes");
  url.searchParams.set("limit", String(SEARCH_POOL_SIZE));
  const response = await fetchJson<JplCatalogResponse>("JPL", url, JPL_SEARCH_TIMEOUT_MS, { next: { revalidate: NASA_CACHE_SECONDS } });
  if (!Array.isArray(response.data)) throw new ExternalApiError("JPL", "JPL returned an invalid asteroid catalog payload");
  const fieldIndex = new Map((response.fields ?? []).map((field, index) => [field, index]));
  return response.data.flatMap((row) => {
    const fullName = String(row[fieldIndex.get("full_name") ?? 0] ?? "");
    const id = String(row[fieldIndex.get("pdes") ?? 1] ?? "");
    const name = String(row[fieldIndex.get("name") ?? 2] ?? "");
    const diameterKm = nullableNumber(row[fieldIndex.get("diameter") ?? -1] ?? undefined);
    const absoluteMagnitude = nullableNumber(row[fieldIndex.get("H") ?? -1] ?? undefined);
    const orbitalPeriodDays = nullableNumber(row[fieldIndex.get("per") ?? -1] ?? undefined);
    const semiMajorAxisAu = nullableNumber(row[fieldIndex.get("a") ?? -1] ?? undefined);
    const eccentricity = nullableNumber(row[fieldIndex.get("e") ?? -1] ?? undefined);
    const inclinationDegrees = nullableNumber(row[fieldIndex.get("i") ?? -1] ?? undefined);
    const perihelionDistanceAu = nullableNumber(row[fieldIndex.get("q") ?? -1] ?? undefined);
    const earthMoidAu = nullableNumber(row[fieldIndex.get("moid") ?? -1] ?? undefined);
    const firstObservationDate = String(row[fieldIndex.get("first_obs") ?? -1] ?? "") || null;
    const lastObservationDate = String(row[fieldIndex.get("last_obs") ?? -1] ?? "") || null;
    const pha = row[fieldIndex.get("pha") ?? -1];
    const orbitClass = String(row[fieldIndex.get("class") ?? -1] ?? "") || null;
    if (!id) return [];
    const designation = fullName?.trim() || (name ? `${id} ${name}` : id);
    const nearEarth = row[fieldIndex.get("neo") ?? -1];
    return [{ id, nasaId: null, designation, estimatedDiameterMinKm: diameterKm, estimatedDiameterMaxKm: diameterKm, hazardous: pha === "Y" ? true : pha === "N" ? false : null, absoluteMagnitude, orbitalPeriodDays, orbitalClass: orbitClass, orbitalClassCode: orbitClass, semiMajorAxisAu, eccentricity, inclinationDegrees, perihelionDistanceAu, earthMoidAu, isNearEarthObject: nearEarth === "Y" ? true : nearEarth === "N" ? false : null, firstObservationDate, lastObservationDate, closeApproachCount: 0 }];
  });
}

async function searchJplCatalog(query: string, includeProvisionalDesignations = false, matchNamePrefix = false): Promise<{ records: ExplorerObjectSummary[]; degraded: boolean }> {
  const key = `${query}|${includeProvisionalDesignations}|${matchNamePrefix}`;
  const cached = catalogSearchCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return { records: cached.records, degraded: false };
  let request = catalogSearchRequests.get(key);
  if (!request) {
    request = fetchJplCatalog(query, includeProvisionalDesignations, matchNamePrefix).then((records) => {
      catalogSearchCache.set(key, { records, expiresAt: Date.now() + CATALOG_SEARCH_CACHE_MS });
      while (catalogSearchCache.size > 64) {
        const oldestKey = catalogSearchCache.keys().next().value;
        if (oldestKey === undefined) break;
        catalogSearchCache.delete(oldestKey);
      }
      return records;
    }).finally(() => catalogSearchRequests.delete(key));
    catalogSearchRequests.set(key, request);
  }
  try {
    return { records: await request, degraded: false };
  } catch (error) {
    if (cached) return { records: cached.records, degraded: true };
    throw error;
  }
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

async function fetchJplObjectDetails(id: string): Promise<ExplorerObjectDetails | null> {
  const url = new URL("https://ssd-api.jpl.nasa.gov/sbdb.api");
  url.searchParams.set("sstr", id);
  url.searchParams.set("phys-par", "true");
  try {
    const response = await fetchJson<JplObjectResponse>("JPL", url, NASA_TIMEOUT_MS, { next: { revalidate: NASA_CACHE_SECONDS } });
    const object = response.object;
    if (!object) return null;
    const designation = object.fullname?.trim() || object.name?.trim() || `${id}`;
    const elements = new Map((response.orbit?.elements ?? []).map((element) => [element.name, element.value]));
    const physicalParameters = new Map((response.phys_par ?? []).map((parameter) => [parameter.name, parameter.value]));
    const diameterKm = nullableNumber(physicalParameters.get("diameter"));
    const approaches = await fetchJplObjectApproaches(id);
    return {
      id: object.des?.trim() || id,
      nasaId: null,
      designation,
      estimatedDiameterMinKm: diameterKm,
      estimatedDiameterMaxKm: diameterKm,
      hazardous: typeof object.pha === "boolean" ? object.pha : null,
      absoluteMagnitude: nullableNumber(physicalParameters.get("H")),
      orbitalPeriodDays: nullableNumber(elements.get("per")),
      semiMajorAxisAu: nullableNumber(elements.get("a")),
      eccentricity: nullableNumber(elements.get("e")),
      inclinationDegrees: nullableNumber(elements.get("i")),
      perihelionDistanceAu: nullableNumber(elements.get("q")),
      earthMoidAu: nullableNumber(elements.get("moid")),
      isNearEarthObject: typeof object.neo === "boolean" ? object.neo : null,
      firstObservationDate: response.orbit?.first_obs ?? null,
      lastObservationDate: response.orbit?.last_obs ?? null,
      closeApproachCount: approaches.length,
      orbitalClass: object.orbit_class?.name ?? object.orbit_class?.code ?? null,
      orbitalClassCode: object.orbit_class?.code ?? null,
      discoveryDate: response.orbit?.first_obs ?? null,
      approaches,
    };
  } catch (error) {
    if (error instanceof ExternalApiError && error.status === 404) return null;
    throw error;
  }
}

async function fetchJplObjectApproaches(id: string): Promise<ExplorerApproach[]> {
  const today = new Date();
  const endDate = new Date(today);
  endDate.setUTCFullYear(today.getUTCFullYear() + JPL_APPROACH_FORECAST_YEARS);
  const url = new URL(JPL_CAD_URL);
  url.searchParams.set("des", id);
  url.searchParams.set("body", "Earth");
  url.searchParams.set("date-min", "1900-01-01");
  url.searchParams.set("date-max", endDate.toISOString().slice(0, 10));
  url.searchParams.set("dist-max", "0.2");
  url.searchParams.set("sort", "date");
  url.searchParams.set("limit", "100");
  const response = await fetchJson<{ fields?: string[]; data?: Array<Array<string>>; count?: number; total?: number }>("JPL CAD", url, NASA_TIMEOUT_MS, { next: { revalidate: NASA_CACHE_SECONDS } });
  if (response.count === 0 || response.total === 0) return [];
  if (!response.fields || !response.data) throw new ExternalApiError("JPL CAD", "JPL returned an invalid close-approach payload");
  const index = new Map(response.fields.map((field, fieldIndex) => [field, fieldIndex]));
  return response.data.flatMap((row) => {
    const dateValue = row[index.get("cd") ?? -1] ?? "";
    const dateMatch = dateValue.match(/^(\d{4})-([A-Za-z]{3})-(\d{2})/);
    const month = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06", Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" }[dateMatch?.[2] ?? ""];
    const distanceAu = Number(row[index.get("dist") ?? -1]);
    const velocityKph = Number(row[index.get("v_rel") ?? -1]) * 3600;
    if (!dateMatch || !month || !Number.isFinite(distanceAu) || !Number.isFinite(velocityKph)) return [];
    const orbitingBody = row[index.get("body") ?? -1] ?? "Earth";
    return [{ date: `${dateMatch[1]}-${month}-${dateMatch[3]}`, missDistanceKm: distanceAu * 149597870.7, relativeVelocityKph: velocityKph, orbitingBody }];
  });
}

function mergeApproaches(...approachLists: ExplorerApproach[][]): ExplorerApproach[] {
  const approaches = approachLists.flat();
  return sortApproaches(approaches.filter((approach, index) => approaches.findIndex((candidate) =>
    candidate.date === approach.date && candidate.orbitingBody === approach.orbitingBody
  ) === index));
}

function mergeObjectDetails(primary: ExplorerObjectDetails, fallback: ExplorerObjectDetails): ExplorerObjectDetails {
  const approaches = mergeApproaches(primary.approaches, fallback.approaches);
  return {
    ...fallback,
    ...primary,
    nasaId: primary.nasaId ?? fallback.nasaId,
    estimatedDiameterMinKm: primary.estimatedDiameterMinKm ?? fallback.estimatedDiameterMinKm,
    estimatedDiameterMaxKm: primary.estimatedDiameterMaxKm ?? fallback.estimatedDiameterMaxKm,
    hazardous: primary.hazardous ?? fallback.hazardous,
    absoluteMagnitude: primary.absoluteMagnitude ?? fallback.absoluteMagnitude,
    orbitalPeriodDays: primary.orbitalPeriodDays ?? fallback.orbitalPeriodDays,
    orbitalClass: primary.orbitalClass ?? fallback.orbitalClass,
    orbitalClassCode: primary.orbitalClassCode ?? fallback.orbitalClassCode,
    semiMajorAxisAu: primary.semiMajorAxisAu ?? fallback.semiMajorAxisAu,
    eccentricity: primary.eccentricity ?? fallback.eccentricity,
    inclinationDegrees: primary.inclinationDegrees ?? fallback.inclinationDegrees,
    perihelionDistanceAu: primary.perihelionDistanceAu ?? fallback.perihelionDistanceAu,
    earthMoidAu: primary.earthMoidAu ?? fallback.earthMoidAu,
    isNearEarthObject: primary.isNearEarthObject ?? fallback.isNearEarthObject,
    firstObservationDate: primary.firstObservationDate ?? fallback.firstObservationDate,
    lastObservationDate: primary.lastObservationDate ?? fallback.lastObservationDate,
    discoveryDate: primary.discoveryDate ?? fallback.discoveryDate,
    closeApproachCount: approaches.length,
    approaches,
  };
}

async function fetchReferenceObjectDetails(id: string): Promise<ExplorerObjectDetails | null> {
  const url = new URL(`${REFERENCE_EXPLORER_URL}/api/explorer/object/${encodeURIComponent(id)}`);
  const response = await fetchJson<ReferenceObjectResponse>("Reference explorer", url, NASA_TIMEOUT_MS, { next: { revalidate: NASA_CACHE_SECONDS } });
  return response.object ?? null;
}

function matchesSearch(record: ExplorerObjectSummary, query: string, matchNamePrefix: boolean): boolean {
  const name = objectName(record.designation);
  return (matchNamePrefix ? name.startsWith(query) : name.includes(query)) || (!matchNamePrefix && record.id.includes(query));
}

function mergeObjectSummaries(primary: ExplorerObjectSummary, fallback: ExplorerObjectSummary): ExplorerObjectSummary {
  return {
    ...fallback,
    ...primary,
    nasaId: primary.nasaId ?? fallback.nasaId,
    estimatedDiameterMinKm: primary.estimatedDiameterMinKm ?? fallback.estimatedDiameterMinKm,
    estimatedDiameterMaxKm: primary.estimatedDiameterMaxKm ?? fallback.estimatedDiameterMaxKm,
    hazardous: primary.hazardous ?? fallback.hazardous,
    absoluteMagnitude: primary.absoluteMagnitude ?? fallback.absoluteMagnitude,
    orbitalPeriodDays: primary.orbitalPeriodDays ?? fallback.orbitalPeriodDays,
    orbitalClass: primary.orbitalClass ?? fallback.orbitalClass,
    orbitalClassCode: primary.orbitalClassCode ?? fallback.orbitalClassCode,
    semiMajorAxisAu: primary.semiMajorAxisAu ?? fallback.semiMajorAxisAu,
    eccentricity: primary.eccentricity ?? fallback.eccentricity,
    inclinationDegrees: primary.inclinationDegrees ?? fallback.inclinationDegrees,
    perihelionDistanceAu: primary.perihelionDistanceAu ?? fallback.perihelionDistanceAu,
    earthMoidAu: primary.earthMoidAu ?? fallback.earthMoidAu,
    isNearEarthObject: primary.isNearEarthObject ?? fallback.isNearEarthObject,
    firstObservationDate: primary.firstObservationDate ?? fallback.firstObservationDate,
    lastObservationDate: primary.lastObservationDate ?? fallback.lastObservationDate,
    closeApproachCount: primary.closeApproachCount ?? fallback.closeApproachCount ?? 0,
  };
}

async function enrichSummary(record: ExplorerObjectSummary): Promise<ExplorerObjectSummary> {
  let details: ExplorerObjectDetails | null;
  try {
    details = await getNeoObjectDetails(record.id);
  } catch (error) {
    if (error instanceof ExternalApiError) return record;
    throw error;
  }
  if (!details) return record;
  return mergeObjectSummaries(details, record);
}

export async function searchNeoObjects(query: string): Promise<ExplorerSearchResponse> {
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery.length < 1) {
    const suggestions = await Promise.all(DEFAULT_SEARCH_SUGGESTIONS.map(enrichSummary));
    return { results: suggestions, degraded: false };
  }
  const matchNamePrefix = /^[a-z]$/.test(normalizedQuery);
  const localMatches = LOCAL_SUGGESTIONS.filter((record) => matchesSearch(record, normalizedQuery, matchNamePrefix));
  if (/^\d{3,}$/.test(normalizedQuery)) {
    const exactLocalMatch = localMatches.find((record) => record.id === normalizedQuery);
    if (exactLocalMatch) {
      const details = await enrichSummary(exactLocalMatch);
      try {
        const catalog = await searchJplCatalog(normalizedQuery, true);
        const catalogMatch = catalog.records.find((record) => record.id === normalizedQuery);
        return { results: [catalogMatch ? mergeObjectSummaries(details, catalogMatch) : details], degraded: catalog.degraded };
      } catch (error) {
        if (!(error instanceof ExternalApiError)) throw error;
        return { results: [details], degraded: true };
      }
    }
    let nasaDegraded = false;
    try {
      const record = await fetchObjectRecord(normalizedQuery);
      const result = record ? toSummary(record) : null;
      if (result) return { results: [result], degraded: false };
    } catch (error) {
      if (!(error instanceof ExternalApiError)) throw error;
      nasaDegraded = true;
    }
    try {
      const catalog = await searchJplCatalog(normalizedQuery, true);
      const catalogMatches = catalog.records.filter((record) => matchesSearch(record, normalizedQuery, false)).slice(0, SEARCH_POOL_SIZE);
      return { results: catalogMatches.length ? catalogMatches : localMatches, degraded: nasaDegraded || catalog.degraded };
    } catch (error) {
      if (!(error instanceof ExternalApiError)) throw error;
      return { results: localMatches, degraded: true };
    }
  }

  let catalog: ExplorerObjectSummary[] = [];
  let degraded = false;
  try {
    const catalogSearch = await searchJplCatalog(normalizedQuery, false, matchNamePrefix);
    catalog = catalogSearch.records;
    degraded = catalogSearch.degraded;
  } catch (error) {
    if (!(error instanceof ExternalApiError)) throw error;
    degraded = true;
  }
  const candidates = catalog.length >= SEARCH_POOL_SIZE ? catalog : [...catalog, ...localMatches];
  const matches: ExplorerObjectSummary[] = [];
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  for (const record of candidates.filter((candidate) => matchesSearch(candidate, normalizedQuery, matchNamePrefix))) {
    const name = objectName(record.designation);
    const duplicate = seenIds.has(record.id) || seenNames.has(name);
    seenIds.add(record.id);
    seenNames.add(name);
    if (!duplicate) matches.push(record);
  }
  const results = matches
    .sort((left, right) => {
      const leftName = objectName(left.designation);
      const rightName = objectName(right.designation);
      return OBJECT_NAME_COLLATOR.compare(leftName, rightName) || left.designation.localeCompare(right.designation);
    })
    .slice(0, SEARCH_POOL_SIZE);
  return { results: degraded ? await Promise.all(results.map(enrichSummary)) : results, degraded };
}

export async function getNeoObjectDetails(id: string): Promise<ExplorerObjectDetails | null> {
  const numericId = Number(id);
  const nasaId = Number.isInteger(numericId) && numericId > 0 && numericId < 2000000 ? String(2000000 + numericId) : id;
  let nasaError: unknown;
  try {
    const record = await fetchObjectRecord(nasaId);
    if (record) {
      const details = toDetails(record);
      if (!details) return null;
      try {
        details.approaches = mergeApproaches(details.approaches, await fetchJplObjectApproaches(id));
        details.closeApproachCount = details.approaches.length;
      } catch (error) {
        if (!(error instanceof ExternalApiError)) throw error;
        console.warn(`[void:JPL CAD] Keeping NASA approach data for ${id}: ${error.message}`);
      }
      return details;
    }
  } catch (error) {
    nasaError = error;
  }

  const [referenceResult, jplResult] = await Promise.allSettled([
    fetchReferenceObjectDetails(nasaId),
    fetchJplObjectDetails(id),
  ]);
  const referenceObject = referenceResult.status === "fulfilled" ? referenceResult.value : null;
  const jplDetails = jplResult.status === "fulfilled" ? jplResult.value : null;
  for (const result of [referenceResult, jplResult]) {
    if (result.status === "rejected") {
      if (!(result.reason instanceof ExternalApiError)) throw result.reason;
      console.warn(`[void:explorer] ${result.reason.message}`);
    }
  }
  if (referenceObject && jplDetails) return mergeObjectDetails(jplDetails, referenceObject);
  if (referenceObject) return referenceObject;
  if (jplDetails) return jplDetails;
  if (nasaError) throw nasaError;
  return null;
}
