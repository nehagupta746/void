export interface ExplorerApproach {
  date: string;
  missDistanceKm: number | null;
  relativeVelocityKph: number | null;
  orbitingBody: string | null;
}

export interface ExplorerObjectSummary {
  id: string;
  nasaId: string | null;
  designation: string;
  estimatedDiameterMinKm: number | null;
  estimatedDiameterMaxKm: number | null;
  hazardous: boolean | null;
  absoluteMagnitude: number | null;
  orbitalPeriodDays: number | null;
  orbitalClass?: string | null;
  orbitalClassCode?: string | null;
  semiMajorAxisAu?: number | null;
  eccentricity?: number | null;
  inclinationDegrees?: number | null;
  perihelionDistanceAu?: number | null;
  earthMoidAu?: number | null;
  isNearEarthObject?: boolean | null;
  firstObservationDate: string | null;
  lastObservationDate: string | null;
  closeApproachCount: number;
}

export interface ExplorerSearchResponse {
  results: ExplorerObjectSummary[];
  degraded: boolean;
}

export interface ExplorerObjectDetails extends ExplorerObjectSummary {
  orbitalClass: string | null;
  orbitalClassCode: string | null;
  discoveryDate: string | null;
  approaches: ExplorerApproach[];
}
