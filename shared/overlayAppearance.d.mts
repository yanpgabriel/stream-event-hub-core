export type OverlayKind =
  "alertas" | "chat" | "destaque" | "widgets" | "sorteio";
export interface OverlayAppearance {
  useSceneColor: boolean;
  accentColor: string;
  textColor: string;
  backgroundColor: string;
  backgroundOpacity: number;
  borderWidth: number;
  borderRadius: number;
  padding: number;
  margin: number;
  maxWidth: number;
  maxHeight: number;
  position: string;
  font: string;
  textAlign: string;
  titleSize: number;
  textSize: number;
  glow: boolean;
  animation: string;
}
export type OverlayAppearances = Record<OverlayKind, OverlayAppearance>;
export interface AppearanceState {
  draft: OverlayAppearances;
  published: OverlayAppearances;
}
export const OVERLAY_KINDS: OverlayKind[];
export const OVERLAY_POSITIONS: string[];
export const OVERLAY_FONTS: Record<string, string>;
export const DEFAULT_APPEARANCES: OverlayAppearances;
export function validateAppearance(
  kind: string,
  patch: unknown,
  base?: OverlayAppearance,
): OverlayAppearance;
