import { createClientFromEnv } from "../client.js";
import { loadConfigFromEnv, mergeProjectConfigIntoEnv } from "../config.js";
import { NIMJI_SYSTEM_PROMPT } from "./prompts.js";
import { parseRawSchedule, buildCheckpointsFromParsedSchedule } from "./schedule-parser.js";
import type { AgentChatResult, ChatMessage, EventProposal } from "./types.js";

export class NimjiAgent {
  private client: ReturnType<typeof createClientFromEnv> | null = null;
  private clientInitialized = false;

  constructor() {
    // Lazily initialized on first prompt
  }

  private initClient(): void {
    if (this.clientInitialized) return;
    try {
      mergeProjectConfigIntoEnv();
      const config = loadConfigFromEnv();
      if (config.auth.cookies && config.auth.atToken) {
        this.client = createClientFromEnv();
      }
    } catch (e) {
      console.warn("[NimjiAgent] Could not initialize live Gemini client:", e);
      this.client = null;
    }
    this.clientInitialized = true;
  }

  /**
   * Main multi-turn conversational method for the Nimji Agent.
   */
  public async chat(params: {
    message: string;
    history?: ChatMessage[];
    pendingProposal?: EventProposal | null;
  }): Promise<AgentChatResult> {
    const { message, history = [], pendingProposal = null } = params;
    const cleanMsg = message.trim();

    // 1. Check if user is responding to a missing title request
    if (pendingProposal && (!pendingProposal.name || pendingProposal.name.trim() === "")) {
      const looksLikeSchedule = /IN:\s*\d|OUT:\s*\d|MORNING|AFTERNOON/i.test(cleanMsg);
      if (!looksLikeSchedule && cleanMsg.length >= 2) {
        // User just gave us the Title!
        const updatedProposal: EventProposal = {
          ...pendingProposal,
          name: cleanMsg,
        };

        return {
          reply: `✨ **Got it!** Event title set to **"${cleanMsg}"**.\n\nHere is your finalized event schedule with all sessions and checkpoints ready for the calendar. Click **"Confirm & Create Event"** below to schedule it immediately!`,
          proposal: updatedProposal,
          status: "ready",
          missingFields: [],
        };
      }
    }

    // 2. Try live Google Gemini generation via Nimji client
    this.initClient();
    if (this.client) {
      try {
        const conversationContext = history
          .slice(-6)
          .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
          .join("\n\n");

        const prompt = `${NIMJI_SYSTEM_PROMPT}\n\n=== CONVERSATION HISTORY ===\n${conversationContext}\n\nUSER: ${cleanMsg}\nASSISTANT:`;
        const res = await this.client.generate({ prompt });

        if (res.ok && res.value.text) {
          const rawText: string = res.value.text;

          // Extract event proposal block if present
          const proposalMatch = rawText.match(/```json:event-proposal\s*([\s\S]*?)\s*```/);
          let parsedProposal: EventProposal | null = null;
          const missingFields: string[] = [];

          if (proposalMatch && proposalMatch[1]) {
            try {
              const parsedJson = JSON.parse(proposalMatch[1]);
              if (parsedJson.event) {
                parsedProposal = parsedJson.event as EventProposal;
              }
            } catch (err) {
              console.warn("[NimjiAgent] Failed to parse proposal JSON:", err);
            }
          }

          // Check if user entered schedule notes
          const rawParsed = parseRawSchedule(cleanMsg);
          const hasParsedSessions = rawParsed.sessions.length > 0;

          if (!parsedProposal && hasParsedSessions) {
            const draftCheckpoints = buildCheckpointsFromParsedSchedule(rawParsed);
            const dateStr = rawParsed.eventDate || new Date().toISOString().split("T")[0];

            parsedProposal = {
              name: rawParsed.rawTitleCandidate || "",
              event_date: dateStr,
              start_time: draftCheckpoints[0]?.startTime || "04:30",
              end_time: draftCheckpoints[draftCheckpoints.length - 1]?.endTime || "18:00",
              location: "Campus Gymnasium / SJ Garden",
              attendance_type: "PRESENT_ABSENT",
              absence_fine: 50,
              late_fine: 0,
              is_surprise_enabled: false,
              departments: ["all"],
              checkpoints: draftCheckpoints,
            };
          }

          // Strict validation: Verify title is present and not a generic placeholder
          if (parsedProposal) {
            const isPlaceholderTitle =
              !parsedProposal.name ||
              /^day\s*\d+$/i.test(parsedProposal.name) ||
              /^untitled/i.test(parsedProposal.name);

            if (isPlaceholderTitle) {
              missingFields.push("Event Title (Name)");
              parsedProposal.name = ""; // Clear so user can supply it
            }
          }

          // Remove the raw JSON block from displayed chat bubble for clean UI
          const cleanReply = rawText.replace(/```json:event-proposal\s*[\s\S]*?\s*```/, "").trim();

          if (missingFields.length > 0 || (hasParsedSessions && !parsedProposal?.name)) {
            return {
              reply: cleanReply,
              proposal: parsedProposal,
              status: "clarifying",
              missingFields: missingFields.length > 0 ? missingFields : ["Event Title (Name)"],
            };
          }

          return {
            reply: cleanReply,
            proposal: parsedProposal,
            status: parsedProposal ? "ready" : "general",
            missingFields: [],
          };
        }
      } catch (err) {
        console.warn(
          "[NimjiAgent] Live Gemini stream failed, switching to local parser fallback:",
          err,
        );
      }
    }

    // 3. Fallback Deterministic Engine (Zero downtime)
    return this.fallbackScheduleProcessing(cleanMsg);
  }

  /**
   * Deterministic local fallback that accurately extracts multi-session schedules.
   */
  private fallbackScheduleProcessing(text: string): AgentChatResult {
    const rawParsed = parseRawSchedule(text);
    const hasSessions = rawParsed.sessions.length > 0;

    if (!hasSessions) {
      return {
        reply: `Hello! I'm **Nimji**, your CCSAS Event & Attendance AI Assistant. 👋\n\nYou can paste any event schedule, timetable, or notes (for example, multi-session intramurals with morning/afternoon in and out times), and I'll structure the checkpoints and schedule it for you. How can I help today?`,
        proposal: null,
        status: "general",
        missingFields: [],
      };
    }

    const checkpoints = buildCheckpointsFromParsedSchedule(rawParsed);
    const dateStr = rawParsed.eventDate || new Date().toISOString().split("T")[0];

    // Determine overall start and end times
    const startTime = checkpoints[0]?.startTime || "04:30";
    const endTime = checkpoints[checkpoints.length - 1]?.endTime || "18:00";

    const proposal: EventProposal = {
      name: rawParsed.rawTitleCandidate || "",
      event_date: dateStr,
      start_time: startTime,
      end_time: endTime,
      location: "Campus Gymnasium / SJ Garden",
      attendance_type: "PRESENT_ABSENT",
      absence_fine: 50,
      late_fine: 0,
      is_surprise_enabled: false,
      departments: ["all"],
      checkpoints,
    };

    if (rawParsed.missingFields.includes("Event Title (Name)") || !proposal.name) {
      const sessionSummary = rawParsed.sessions
        .map((s) => {
          const inTxt = s.inWindow ? `IN: ${s.inWindow.start} - ${s.inWindow.end}` : "";
          const outTxt = s.outWindow
            ? `OUT: ${s.outWindow.start} - ${s.outWindow.end} (${s.outWindow.rawText || "Scheduled"})`
            : "";
          return `• **${s.header.toUpperCase()}** ${s.location ? `(${s.location})` : ""}: ${[inTxt, outTxt].filter(Boolean).join(" | ")}`;
        })
        .join("\n");

      return {
        reply: `📅 **Parsed Schedule for ${dateStr}**:\n${sessionSummary}\n\n⚠️ **Required Information Needed**:\nBefore I can schedule this event in the system, please provide:\n1. **Event Title** (e.g., *"CCS Days 2026: Day 4"* or *"Intramural Games - Day 4"*)\n\nWhat would you like to name this event?`,
        proposal,
        status: "clarifying",
        missingFields: ["Event Title (Name)"],
      };
    }

    return {
      reply: `✨ **Event Schedule Ready!**\nI've parsed the schedule with **${checkpoints.length} checkpoints** on **${dateStr}**. Please review the preview card below and click **"Confirm & Create Event"** to schedule it!`,
      proposal,
      status: "ready",
      missingFields: [],
    };
  }
}
