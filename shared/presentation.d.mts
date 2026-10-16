export interface SceneLayout {
  canvas: { width: number; height: number };
  theme: {
    color: string;
    particles: boolean;
    flicker: boolean;
    vignette: boolean;
  };
  webcam: {
    enabled: boolean;
    corner: string;
    width: number;
    height: number;
    sideMargin: number;
    bottomMargin: number;
    topMargin: number;
    padding: number;
    showLabel: boolean;
    label: string;
  };
  topbar: {
    enabled: boolean;
    showGoal: boolean;
    showStat: boolean;
    socialLabel: string;
    socialValue: string;
  };
  chat: {
    enabled: boolean;
    mode: string;
    limit: number;
    textSize: number;
    overlayWidth: number;
    overlayHeight: number;
  };
  activity: { enabled: boolean; limit: number; source: string };
  ticker: { enabled: boolean; text: string; speed: number };
  goal: { label: string; target: number; mode: string };
  stat: { label: string; value: string; source: string };
  qr: { enabled: boolean; text: string };
  message: { enabled: boolean; text: string; effect: string };
  connection: { behavior: string };
}
export interface SceneActivity {
  id: string;
  name: string;
  label: string;
  source: string;
}
export interface SceneRuntime {
  goalCurrent: number;
  timerStartedAt: number | null;
  timerElapsedMs: number;
  activity: SceneActivity[];
}
export interface SceneSnapshot {
  layout: SceneLayout;
  runtime: SceneRuntime;
  currentGoal: number;
  statValue: string;
  activity: SceneActivity[];
  revision: number;
}
export const DEFAULT_LAYOUT: SceneLayout;
export const DEFAULT_RUNTIME: SceneRuntime;
export function cameraGeometry(
  layout: SceneLayout,
  baseWidth?: number,
  baseHeight?: number,
): {
  outer: { x: number; y: number; width: number; height: number };
  inner: { x: number; y: number; width: number; height: number };
};
export function goalValue(
  layout: SceneLayout,
  runtime: SceneRuntime,
  metrics?: Record<string, any>,
): number;
