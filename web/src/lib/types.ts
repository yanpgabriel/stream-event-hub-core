export type Platform = "twitch" | "youtube" | "livepix";
export type AlertType = "follow" | "sub" | "tip" | "cheer" | "raid";
export type Data = Record<string, any>;
export interface Session {
  authenticated: boolean;
  username: string;
  csrfToken: string;
  trustedLocal?: boolean;
}
export interface ChatMessage {
  id: string;
  source: string;
  userId?: string;
  chatname: string;
  chatmessage: string;
  timestamp: string;
  chatimg?: string;
  chatbadges?: { label?: string; url?: string; type?: string }[];
  donation?: string;
}
export interface ChatState {
  recent: ChatMessage[];
  featured: ChatMessage | null;
  options: Data;
  total: number;
}
export interface RaffleState {
  isActive: boolean;
  keyword: string;
  participants: { name: string; platform: string }[];
  winners: { name: string; platform: string }[];
}
export interface HistoryEntry {
  id: number;
  timestamp: string;
  type: AlertType;
  listener: string;
  platform?: string;
  replay?: boolean;
  event: Data;
}
export interface AlertPayload {
  listener: string;
  event: Data;
  sound?: { url: string; volume: number };
  tts?: {
    enabled: Record<string, boolean>;
    voice: string;
    rate: number;
    volume: number;
  };
  alertDuration: number;
  alertMessageTextSize?: number;
  target: string;
}
export interface Sound {
  filename: string;
  url: string;
  size: number;
}
export const platforms: Platform[] = ["twitch", "youtube", "livepix"];
export const platformNames: Record<string, string> = {
  twitch: "Twitch",
  youtube: "YouTube",
  livepix: "LivePix",
  manual: "Manual",
  replay: "Replay",
};
export const alertNames: Record<AlertType, string> = {
  follow: "Novo seguidor",
  sub: "Inscrição / membro",
  tip: "Doação",
  cheer: "Bits",
  raid: "Raid",
};
export const alertTypes = Object.keys(alertNames) as AlertType[];
