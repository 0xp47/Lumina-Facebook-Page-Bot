export type AgentRole = "system" | "user" | "assistant";

export interface ChatMessage {
  id: string;
  role: AgentRole;
  content: string;
  timestamp?: number;
  proposal?: EventProposal | null;
  missingFields?: string[];
  actionStatus?: "idle" | "clarifying" | "ready" | "created" | "error";
}

export type CheckpointType = "IN" | "SA" | "OUT" | "CUSTOM";

export interface ParsedCheckpoint {
  id: string;
  type: CheckpointType;
  name: string;
  sublabel?: string;
  startTime: string;
  endTime: string;
  enabled: boolean;
}

export interface EventProposal {
  name?: string;
  description?: string;
  event_date: string;
  start_time: string;
  end_time: string;
  location: string;
  attendance_type: "PRESENT_ABSENT" | "IN" | "OUT";
  absence_fine: number;
  late_fine: number;
  is_surprise_enabled: boolean;
  departments: string[];
  checkpoints: ParsedCheckpoint[];
  notes?: string;
}

export interface AgentChatResult {
  reply: string;
  proposal: EventProposal | null;
  status: "clarifying" | "ready" | "created" | "general";
  missingFields: string[];
}

export interface CreateEventInput {
  name: string;
  description?: string;
  event_date: string;
  start_time: string;
  end_time: string;
  location?: string;
  attendance_type?: string;
  in_start_time?: string | null;
  in_end_time?: string | null;
  out_start_time?: string | null;
  out_end_time?: string | null;
  surprise_start_time?: string | null;
  surprise_end_time?: string | null;
  is_surprise_enabled?: boolean;
  absence_fine?: number;
  late_fine?: number;
  auto_close_camera?: boolean;
  departments?: string[];
  checkpoints?: ParsedCheckpoint[];
}
