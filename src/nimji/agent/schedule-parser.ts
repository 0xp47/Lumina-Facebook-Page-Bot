import type { ParsedCheckpoint } from "./types.js";

/**
 * Normalizes any time string (e.g., "4:30 AM", "4:30", "15:30", "3:30 PM", "8:45")
 * into a strict HH:MM 24-hour string.
 */
export function normalizeTimeTo24h(
  timeStr: string | null | undefined,
  isPMHint: boolean = false,
): string | null {
  if (!timeStr) return null;
  const clean = timeStr.trim().toUpperCase();
  const match = clean.match(/(\d{1,2}):(\d{2})(?:\s*(AM|PM))?/);
  if (!match) return null;

  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const meridiem = match[3];

  if (meridiem === "PM" && hours < 12) {
    hours += 12;
  } else if (meridiem === "AM" && hours === 12) {
    hours = 0;
  } else if (!meridiem && isPMHint && hours < 12) {
    hours += 12;
  }

  const hStr = hours.toString().padStart(2, "0");
  const mStr = minutes.toString().padStart(2, "0");
  return `${hStr}:${mStr}`;
}

/**
 * Extracts date from phrases like "Sept 18", "September 18", "Day 4 (Sept 18)", "2026-09-18"
 */
export function extractDateFromText(text: string, currentYear: number = 2026): string | null {
  const isoMatch = text.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (isoMatch) {
    const y = isoMatch[1];
    const m = isoMatch[2].padStart(2, "0");
    const d = isoMatch[3].padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  const months: Record<string, number> = {
    jan: 1,
    january: 1,
    feb: 2,
    february: 2,
    mar: 3,
    march: 3,
    apr: 4,
    april: 4,
    may: 5,
    jun: 6,
    june: 6,
    jul: 7,
    july: 7,
    aug: 8,
    august: 8,
    sep: 9,
    sept: 9,
    september: 9,
    oct: 10,
    october: 10,
    nov: 11,
    november: 11,
    dec: 12,
    december: 12,
  };

  const monthRegex =
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?\b/i;
  const match = text.match(monthRegex);
  if (match) {
    const monthName = match[1].toLowerCase();
    const monthNum = months[monthName] || 1;
    const dayNum = parseInt(match[2], 10);
    return `${currentYear}-${monthNum.toString().padStart(2, "0")}-${dayNum.toString().padStart(2, "0")}`;
  }

  return null;
}

export interface ParsedSessionBlock {
  header: string;
  location?: string;
  inWindow?: { start: string; end: string };
  outWindow?: { start: string; end: string; rawText?: string };
}

export interface RawScheduleParseResult {
  eventDate: string;
  rawTitleCandidate: string | null;
  missingFields: string[];
  sessions: ParsedSessionBlock[];
}

/**
 * Analyzes unstructured schedule notes (e.g. Day 4 Fun Run / SJ Garden notes).
 */
export function parseRawSchedule(text: string): RawScheduleParseResult {
  const eventDate = extractDateFromText(text) || new Date().toISOString().split("T")[0];
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const missingFields: string[] = [];
  let rawTitleCandidate: string | null = null;

  // Check if first line looks like an explicit title or just a Day marker
  const firstLine = lines[0] || "";
  const isDayMarkerOnly = /^day\s*\d+\s*(?:\([^)]*\))?$/i.test(firstLine);

  if (isDayMarkerOnly) {
    // Only a day marker (e.g. "Day 4 (Sept 18)") - official title is missing!
    missingFields.push("Event Title (Name)");
  } else if (/^create\s+event/i.test(firstLine)) {
    missingFields.push("Event Title (Name)");
  } else if (firstLine.length > 3 && !firstLine.includes(":") && !isDayMarkerOnly) {
    rawTitleCandidate = firstLine;
  } else {
    missingFields.push("Event Title (Name)");
  }

  const sessions: ParsedSessionBlock[] = [];
  let currentHeader = "General";
  let currentLocation: string | undefined = undefined;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Detect section headers
    if (/^(morning|sj garden|afternoon|evening|night|gymnasium|quadrangle)\b/i.test(line)) {
      currentHeader = line;
      if (/sj garden/i.test(line)) {
        currentLocation = "SJ Garden";
      }
      continue;
    }

    // Match IN window: e.g. "IN: 4:30-5:00 AM" or "IN: 8:30-8:45" or "IN: 3:30-4:00 PM"
    const inMatch = line.match(/^IN:\s*(\d{1,2}:\d{2})(?:\s*-\s*(\d{1,2}:\d{2}))?\s*(AM|PM)?/i);
    if (inMatch) {
      const isAfternoon = /afternoon|pm/i.test(currentHeader) || inMatch[3] === "PM";
      const start =
        normalizeTimeTo24h(inMatch[1] + (inMatch[3] ? ` ${inMatch[3]}` : ""), isAfternoon) ||
        "08:00";
      let end = inMatch[2]
        ? normalizeTimeTo24h(inMatch[2] + (inMatch[3] ? ` ${inMatch[3]}` : ""), isAfternoon)
        : null;

      if (!end) {
        // default 30 min window
        const [h, m] = start.split(":").map(Number);
        const endTotal = h * 60 + m + 30;
        end = `${Math.floor(endTotal / 60)
          .toString()
          .padStart(2, "0")}:${(endTotal % 60).toString().padStart(2, "0")}`;
      }

      // Check next line for OUT window
      let outWindow: { start: string; end: string; rawText?: string } | undefined = undefined;
      const nextLine = lines[i + 1] || "";
      if (/^OUT:/i.test(nextLine)) {
        const outTimeMatch = nextLine.match(
          /^OUT:\s*(\d{1,2}:\d{2})(?:\s*-\s*(\d{1,2}:\d{2}))?\s*(AM|PM)?/i,
        );
        if (outTimeMatch) {
          const outStart =
            normalizeTimeTo24h(
              outTimeMatch[1] + (outTimeMatch[3] ? ` ${outTimeMatch[3]}` : ""),
              isAfternoon,
            ) || "11:30";
          const outEnd = outTimeMatch[2]
            ? normalizeTimeTo24h(
                outTimeMatch[2] + (outTimeMatch[3] ? ` ${outTimeMatch[3]}` : ""),
                isAfternoon,
              ) || "12:00"
            : "12:00";
          outWindow = { start: outStart, end: outEnd, rawText: nextLine };
        } else {
          // Relative like "OUT: After Fun Run" or "OUT: After Program"
          let defaultStart = "11:30";
          let defaultEnd = "12:00";
          if (/fun run/i.test(nextLine)) {
            defaultStart = "07:00";
            defaultEnd = "07:30";
          } else if (/game of low/i.test(nextLine)) {
            defaultStart = "11:00";
            defaultEnd = "11:30";
          } else if (/program/i.test(nextLine)) {
            defaultStart = "17:00";
            defaultEnd = "17:30";
          }
          outWindow = {
            start: defaultStart,
            end: defaultEnd,
            rawText: nextLine.replace(/^OUT:\s*/i, ""),
          };
        }
        i++; // skip nextLine since processed
      }

      sessions.push({
        header: currentHeader,
        location: currentLocation,
        inWindow: { start, end },
        outWindow,
      });
    }
  }

  return {
    eventDate,
    rawTitleCandidate,
    missingFields,
    sessions,
  };
}

/**
 * Converts parsed sessions into formal CCSAS Checkpoints.
 */
export function buildCheckpointsFromParsedSchedule(
  parsed: RawScheduleParseResult,
): ParsedCheckpoint[] {
  const checkpoints: ParsedCheckpoint[] = [];
  let counter = 1;

  for (const session of parsed.sessions) {
    const sessionLabel = session.header.toUpperCase();

    if (session.inWindow) {
      checkpoints.push({
        id: `cp_${counter++}`,
        type: "IN",
        name: `${sessionLabel} Check-In`,
        sublabel: session.location || sessionLabel,
        startTime: session.inWindow.start,
        endTime: session.inWindow.end,
        enabled: true,
      });
    }

    if (session.outWindow) {
      const raw = session.outWindow.rawText?.trim() || "";
      const formattedSublabel = raw
        ? /^after\b/i.test(raw)
          ? raw
          : `After ${raw}`
        : session.location || sessionLabel;

      checkpoints.push({
        id: `cp_${counter++}`,
        type: "OUT",
        name: `${sessionLabel} Check-Out`,
        sublabel: formattedSublabel,
        startTime: session.outWindow.start,
        endTime: session.outWindow.end,
        enabled: true,
      });
    }
  }

  return checkpoints;
}
