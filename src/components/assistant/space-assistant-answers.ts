import type { SpaceAssistantPageData } from "@/components/assistant/SpaceAssistantContext";
import type { ExplorerObjectDetails } from "@/types/explorer";
import type { CloseApproach } from "@/types/mission";

export interface SpaceAssistantAnswer {
  kind: "Explanation" | "Displayed data" | "Unavailable";
  text: string;
}

const numberFormatter = new Intl.NumberFormat("en", { maximumFractionDigits: 2 });
const dateFormatter = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" });
const timeFormatter = new Intl.DateTimeFormat("en", { hour: "2-digit", minute: "2-digit", timeZone: "UTC", hour12: false });

function number(value: number | null | undefined, unit = ""): string {
  return value === null || value === undefined ? "Unavailable" : `${numberFormatter.format(value)}${unit}`;
}

function date(value: string | null | undefined): string {
  if (!value) return "Unavailable";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Unavailable";
  return value.includes("T") ? `${dateFormatter.format(parsed)} ${timeFormatter.format(parsed)} UTC` : dateFormatter.format(parsed);
}

function unavailableData(data: SpaceAssistantPageData | null, subject: string): SpaceAssistantAnswer {
  if (data?.status === "error") {
    return { kind: "Unavailable", text: `The current page data could not be loaded${data.error ? `: ${data.error}` : "."}` };
  }
  if (data?.status === "loading") {
    return { kind: "Unavailable", text: "This page's data is still loading. Try again when synchronization finishes." };
  }
  return { kind: "Unavailable", text: `${subject} is not available in the current page data. VOID will not fill in missing values.` };
}

function diameterRange(object: ExplorerObjectDetails): string {
  const min = object.estimatedDiameterMinKm;
  const max = object.estimatedDiameterMaxKm;
  if (min === null && max === null) return "Diameter unavailable";
  if (min === null) return `Up to ${number(max, " km")}`;
  if (max === null) return `At least ${number(min, " km")}`;
  if (min === max) return number(min, " km");
  return `${number(min, " km")} to ${number(max, " km")}`;
}

function explorerAnswers(data: Extract<SpaceAssistantPageData, { page: "explorer" }>, question: string): SpaceAssistantAnswer[] {
  const object = data.object;
  if (!object) return [unavailableData(data, "A selected asteroid record")];
  const answers: SpaceAssistantAnswer[] = [];
  const lower = question.toLowerCase();

  if (/moid|minimum orbit|orbital proximity/.test(lower)) {
    answers.push({
      kind: "Explanation",
      text: "Earth MOID describes orbit geometry. It is not a predicted or dated encounter.",
    });
    answers.push({ kind: "Displayed data", text: `Earth MOID: ${number(object.earthMoidAu, " AU")}.` });
  }
  if (/h magnitude|absolute magnitude|\bsize\b/.test(lower)) {
    answers.push({
      kind: "Explanation",
      text: "VOID labels H magnitude as a size proxy when direct diameter data is unavailable. It is not a direct diameter measurement.",
    });
    answers.push({
      kind: "Displayed data",
      text: `Absolute magnitude (H): ${number(object.absoluteMagnitude)}. Estimated diameter: ${diameterRange(object)}.`,
    });
  }
  if (/threat|hazard|risk|score/.test(lower)) {
    answers.push({
      kind: "Explanation",
      text: "The VOID threat score is a catalog-based heuristic, not an official risk rating. H magnitude and Earth MOID may be labeled proxies when direct size or encounter data is unavailable.",
    });
    answers.push({
      kind: "Displayed data",
      text: `NASA/JPL classification: ${object.hazardous === null ? "Unavailable" : object.hazardous ? "Potentially hazardous" : "Not classified as potentially hazardous"}.`,
    });
  }
  if (/approach|encounter|miss distance|velocity/.test(lower)) {
    const approaches = object.approaches.slice(0, 3);
    answers.push({
      kind: "Explanation",
      text: "These are the close-approach records shown for the selected object. The dates, distances, and velocities below are displayed values, not a new prediction.",
    });
    answers.push({
      kind: approaches.length ? "Displayed data" : "Unavailable",
      text: approaches.length
        ? approaches.map((approach) => `${date(approach.date)}: miss distance ${number(approach.missDistanceKm, " km")}; relative velocity ${number(approach.relativeVelocityKph, " km/h")}${approach.orbitingBody ? `; body ${approach.orbitingBody}` : ""}.`).join(" ")
        : "No close-approach records are available for this object.",
    });
  }
  if (/orbital class|orbit class|aten|apollo|amor|atira/.test(lower)) {
    answers.push({
      kind: object.orbitalClass ? "Displayed data" : "Unavailable",
      text: object.orbitalClass ? `Published orbital class: ${object.orbitalClass}.` : "Orbital class is unavailable for this object.",
    });
  }
  if (/period/.test(lower)) {
    answers.push({
      kind: "Explanation",
      text: "Orbital period is the duration of one orbit.",
    });
    answers.push({ kind: "Displayed data", text: `Orbital period: ${number(object.orbitalPeriodDays, " days")}.` });
  }
  if (/inclination/.test(lower)) {
    answers.push({ kind: "Explanation", text: "Inclination describes the tilt of an orbit, expressed in degrees." });
    answers.push({ kind: "Displayed data", text: `Inclination: ${number(object.inclinationDegrees, "°")}.` });
  }
  if (/eccentricity|orbit shape/.test(lower)) {
    answers.push({ kind: "Explanation", text: "Eccentricity describes how stretched an orbit is; values closer to zero describe a more circular shape." });
    answers.push({ kind: "Displayed data", text: `Eccentricity: ${number(object.eccentricity)}.` });
  }
  if (/semi.major|orbital distance/.test(lower)) {
    answers.push({ kind: "Explanation", text: "The semi-major axis is half the longest diameter of an elliptical orbit." });
    answers.push({ kind: "Displayed data", text: `Semi-major axis: ${number(object.semiMajorAxisAu, " AU")}.` });
  }
  if (/perihelion/.test(lower)) {
    answers.push({ kind: "Explanation", text: "Perihelion is the point in an orbit closest to the Sun." });
    answers.push({ kind: "Displayed data", text: `Perihelion distance: ${number(object.perihelionDistanceAu, " AU")}.` });
  }
  if (/diameter/.test(lower)) {
    answers.push({
      kind: "Displayed data",
      text: `Estimated diameter: ${diameterRange(object)}.`,
    });
  }

  if (!answers.length) {
    answers.push({
      kind: "Explanation",
      text: "I can explain the selected asteroid's close approaches, threat classification, H magnitude, Earth MOID, orbital class, period, inclination, eccentricity, semi-major axis, or perihelion. Ask about one of those displayed fields.",
    });
  }
  return answers;
}

function missionAnswers(snapshot: Extract<SpaceAssistantPageData, { page: "mission" }>["snapshot"], question: string): SpaceAssistantAnswer[] {
  if (!snapshot) return [unavailableData(null, "Mission data")];
  const lower = question.toLowerCase();
  const answers: SpaceAssistantAnswer[] = [];

  if (/approach|encounter|distance|velocity|risk|hazard/.test(lower)) {
    const approaches: CloseApproach[] = snapshot.closeApproaches.slice(0, 3);
    answers.push({
      kind: "Explanation",
      text: "Mission Control lists close-approach entries with their displayed date, distance, relative velocity, and VOID risk label. The label is presented as received; this assistant does not recalculate it.",
    });
    answers.push({
      kind: approaches.length ? "Displayed data" : "Unavailable",
      text: approaches.length
        ? approaches.map((approach) => `${approach.name}: ${date(approach.date)}; ${number(approach.distanceKm, " km")} miss distance; ${number(approach.relativeVelocityKph, " km/h")} relative velocity; ${approach.risk} risk label.`).join(" ")
        : "No close-approach entries are available in the current mission snapshot.",
    });
  }
  if (/telemetry|tracked|latency|overview|chart|matrix|status/.test(lower)) {
    const telemetry = snapshot.telemetry;
    answers.push({
      kind: "Explanation",
      text: "The telemetry matrix reports the tracked-object count, close-approach count, hazard level, and data latency from the current mission snapshot. Values marked unavailable are not replaced with estimates.",
    });
    answers.push({
      kind: "Displayed data",
      text: `Tracked objects: ${number(telemetry.trackedObjects)}. Close approaches: ${number(telemetry.closeApproaches)}. Hazard level: ${telemetry.hazardLevel ?? "Unavailable"}. Data latency: ${number(telemetry.latencyMs, " ms")}.`,
    });
  }
  if (/iss|station|latitude|longitude|altitude/.test(lower)) {
    const position = snapshot.iss;
    answers.push({
      kind: position ? "Displayed data" : "Unavailable",
      text: position
        ? `ISS position from the mission snapshot: latitude ${number(position.latitude, "°")}, longitude ${number(position.longitude, "°")}, altitude ${number(position.altitudeKm, " km")}, velocity ${number(position.velocityKph, " km/h")}. Timestamp: ${date(position.timestamp)}.`
        : "ISS position is unavailable in the current mission snapshot.",
    });
  }
  if (!answers.length) {
    answers.push({
      kind: "Displayed data",
      text: `Mission snapshot updated ${date(snapshot.updatedAt)}. It contains ${number(snapshot.satellites.length)} catalog objects and ${number(snapshot.closeApproaches.length)} close-approach entries.`,
    });
    answers.push({ kind: "Explanation", text: "Ask about the telemetry matrix, an approach entry, or the ISS position shown on Mission Control." });
  }
  return answers;
}

function issAnswers(snapshot: Extract<SpaceAssistantPageData, { page: "iss" }>["snapshot"], question: string): SpaceAssistantAnswer[] {
  if (!snapshot) return [unavailableData(null, "ISS telemetry")];
  const lower = question.toLowerCase();
  const answers: SpaceAssistantAnswer[] = [];

  if (/position|latitude|longitude|altitude|velocity|telemetry|where/.test(lower)) {
    const position = snapshot.position;
    answers.push({
      kind: "Explanation",
      text: "Latitude and longitude are the displayed position coordinates. Altitude and velocity are the values reported in the ISS telemetry; the timestamp identifies when the position was recorded.",
    });
    answers.push({
      kind: position ? "Displayed data" : "Unavailable",
      text: position
        ? `Current displayed position: latitude ${number(position.latitude, "°")}, longitude ${number(position.longitude, "°")}; altitude ${number(position.altitudeKm, " km")}; velocity ${number(position.velocityKph, " km/h")}. Timestamp: ${date(position.timestamp)}.`
        : "ISS position telemetry is unavailable in the current snapshot.",
    });
  }
  if (/orbit|period|heading|direction|daylight|night|visibility|distance/.test(lower)) {
    const orbital = snapshot.orbital;
    answers.push({
      kind: orbital ? "Displayed data" : "Unavailable",
      text: orbital
        ? `Displayed orbital information: period ${number(orbital.orbitalPeriodMinutes, " min")}; orbit number ${number(orbital.orbitNumber)}; estimated distance travelled today ${number(orbital.estimatedDistanceTravelledKm, " km")}; visibility ${orbital.visibility}; heading ${number(orbital.directionDegrees, "°")}.`
        : "Orbital information is unavailable in the current snapshot.",
    });
    if (/period/.test(lower)) answers.push({ kind: "Explanation", text: "Orbital period is the duration of one orbit. The value above is the value displayed by VOID." });
    if (/heading|direction/.test(lower)) answers.push({ kind: "Explanation", text: "Heading is the direction value displayed by VOID; the assistant does not infer a direction when the value is unavailable." });
  }
  if (/event|activity/.test(lower)) {
    answers.push({
      kind: snapshot.events.length ? "Displayed data" : "Unavailable",
      text: snapshot.events.length
        ? snapshot.events.slice(0, 3).map((event) => `${date(event.timestamp)}: ${event.message}`).join(" ")
        : "No mission events are available in the current ISS snapshot.",
    });
  }
  if (!answers.length) {
    answers.push({ kind: "Explanation", text: "I can explain the ISS position, live telemetry, orbital information, heading, visibility, or mission events shown on this page. Ask about one of those fields." });
  }
  return answers;
}

export function answerSpaceQuestion(data: SpaceAssistantPageData | null, page: SpaceAssistantPageData["page"], question: string): SpaceAssistantAnswer[] {
  if (page === "settings") {
    return [{
      kind: "Explanation",
      text: "I can explain the asteroid records, close approaches, orbital parameters, mission telemetry, and ISS information displayed in VOID. Open Mission, Explorer, or ISS to include that page's current values.",
    }];
  }
  if (!data || data.page !== page) return [unavailableData(null, "Current page data")];
  if (data.status === "error" && !("snapshot" in data && data.snapshot) && !("object" in data && data.object)) {
    return [unavailableData(data, "Current page data")];
  }

  if (data.page === "explorer") return explorerAnswers(data, question);
  if (data.page === "mission") {
    if (!data.snapshot && data.status !== "ready") return [unavailableData(data, "Mission data")];
    return missionAnswers(data.snapshot, question);
  }
  if (data.page === "iss") {
    if (!data.snapshot && data.status !== "ready") return [unavailableData(data, "ISS telemetry")];
    return issAnswers(data.snapshot, question);
  }

  return [unavailableData(data, "Page-specific data")];
}

export function getSuggestedQuestions(page: SpaceAssistantPageData["page"]): string[] {
  if (page === "explorer") return ["What does Earth MOID mean?", "Explain this object's threat classification", "What do its close-approach records show?"];
  if (page === "iss") return ["Explain the ISS telemetry", "What does orbital period mean?", "What information is in the orbit panel?"];
  if (page === "mission") return ["Explain the telemetry matrix", "What do the close-approach values show?", "What ISS data is displayed?"];
  return ["What can the VOID assistant explain?", "How can I understand a close-approach entry?"];
}
