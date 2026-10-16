export const DEFAULT_LAYOUT = {
  canvas: { width: 1920, height: 1080 },
  theme: { color: "#39ff14", particles: true, flicker: false, vignette: true },
  webcam: {
    enabled: true,
    corner: "bottom-right",
    width: 380,
    height: 215,
    sideMargin: 60,
    bottomMargin: 60,
    topMargin: 80,
    padding: 3,
    showLabel: true,
    label: "LIVE ONLINE",
  },
  topbar: {
    enabled: true,
    showGoal: true,
    showStat: true,
    socialLabel: "Instagram",
    socialValue: "",
  },
  chat: {
    enabled: true,
    mode: "native",
    limit: 5,
    textSize: 20,
    overlayWidth: 450,
    overlayHeight: 540,
  },
  activity: { enabled: true, limit: 3, source: "mixed" },
  ticker: {
    enabled: true,
    text: "Bem-vindo à transmissão! • Apoie o canal • Acompanhe nossas redes",
    speed: 30,
  },
  goal: { label: "Meta de Subs", target: 50, mode: "manual" },
  stat: { label: "Último seguidor", value: "", source: "lastFollower" },
  qr: { enabled: false, text: "" },
  message: { enabled: false, text: "", effect: "pulse" },
  connection: { behavior: "keep" },
};
export const DEFAULT_RUNTIME = {
  goalCurrent: 0,
  timerStartedAt: null,
  timerElapsedMs: 0,
  activity: [],
};

export function cameraGeometry(
  layout,
  baseWidth = layout.canvas.width,
  baseHeight = layout.canvas.height,
) {
  const {
    width,
    height,
    sideMargin,
    bottomMargin,
    topMargin,
    padding,
    corner,
  } = layout.webcam;
  const x = corner.endsWith("left")
    ? sideMargin
    : layout.canvas.width - sideMargin - width;
  const y = corner.startsWith("top")
    ? topMargin
    : layout.canvas.height - bottomMargin - height;
  const sx = baseWidth / layout.canvas.width;
  const sy = baseHeight / layout.canvas.height;
  return {
    outer: { x: x * sx, y: y * sy, width: width * sx, height: height * sy },
    inner: {
      x: (x + padding) * sx,
      y: (y + padding) * sy,
      width: (width - padding * 2) * sx,
      height: (height - padding * 2) * sy,
    },
  };
}

export function goalValue(layout, runtime, metrics = {}) {
  switch (layout.goal.mode) {
    case "twitchSubs":
      return runtime.goalCurrent + (metrics.twitchSubs?.total || 0);
    case "youtubeMembers":
      return runtime.goalCurrent + (metrics.youtubeMembers?.total || 0);
    case "bits":
      return runtime.goalCurrent + (metrics.twitchBits?.total || 0);
    case "donations":
      return (
        runtime.goalCurrent +
        ((metrics.youtubeTips?.totalBrlMinor || 0) +
          (metrics.livepixTips?.totalBrlMinor || 0)) /
          100
      );
    default:
      return runtime.goalCurrent;
  }
}
