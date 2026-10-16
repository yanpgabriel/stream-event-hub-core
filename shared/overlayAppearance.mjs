export const OVERLAY_KINDS = [
  "alertas",
  "chat",
  "destaque",
  "widgets",
  "sorteio",
];
export const OVERLAY_FONTS = {
  system: "system-ui, sans-serif",
  sans: "Arial, Helvetica, sans-serif",
  serif: 'Georgia, "Times New Roman", serif',
  mono: 'Consolas, "Courier New", monospace',
};
export const OVERLAY_POSITIONS = [
  "top-left",
  "top-center",
  "top-right",
  "center-left",
  "center-center",
  "center-right",
  "bottom-left",
  "bottom-center",
  "bottom-right",
];
export const DEFAULT_APPEARANCES = Object.fromEntries(
  OVERLAY_KINDS.map((kind) => [
    kind,
    {
      useSceneColor: false,
      accentColor: "#bb98eb",
      textColor: "#f1e9fc",
      backgroundColor: "#15131e",
      backgroundOpacity: 90,
      borderWidth: kind === "chat" ? 3 : 1,
      borderRadius: kind === "chat" ? 6 : kind === "widgets" ? 12 : 18,
      padding: kind === "chat" ? 14 : 30,
      margin: 25,
      maxWidth: 0,
      maxHeight: 0,
      position: "bottom-center",
      font: "system",
      textAlign: kind === "chat" ? "left" : "center",
      titleSize: kind === "chat" ? 14 : kind === "widgets" ? 23 : 36,
      textSize: 0,
      glow: kind !== "chat",
      animation: "fade",
    },
  ]),
);

// A mesma validação é usada no servidor e na prévia isolada do editor.
export function validateAppearance(
  kind,
  patch,
  base = DEFAULT_APPEARANCES[kind],
) {
  const invalid = (message) => {
    throw new Error(message);
  };
  if (!OVERLAY_KINDS.includes(kind)) invalid("Overlay inválido.");
  if (!patch || typeof patch !== "object" || Array.isArray(patch))
    invalid("A aparência deve ser um objeto.");
  const next = { ...DEFAULT_APPEARANCES[kind], ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (!Object.hasOwn(DEFAULT_APPEARANCES[kind], key))
      invalid(`Campo de aparência desconhecido: ${key}`);
    if (typeof value !== typeof DEFAULT_APPEARANCES[kind][key])
      invalid(`Valor de aparência inválido: ${key}`);
    next[key] = value;
  }
  for (const key of ["accentColor", "textColor", "backgroundColor"]) {
    if (!/^#[a-f0-9]{6}$/i.test(next[key]))
      invalid(`Cor inválida: ${key}. Use hexadecimal de seis dígitos.`);
  }
  const bounds = {
    backgroundOpacity: [0, 100],
    borderWidth: [0, 20],
    borderRadius: [0, 150],
    padding: [0, 150],
    margin: [0, 300],
    maxWidth: [0, 3840],
    maxHeight: [0, 2160],
    titleSize: [8, 150],
    textSize: [0, 150],
  };
  for (const [key, [min, max]] of Object.entries(bounds)) {
    if (
      !Number.isInteger(next[key]) ||
      next[key] < min ||
      next[key] > max ||
      (key === "textSize" && next[key] > 0 && next[key] < 8)
    )
      invalid(
        `Medida inválida: ${key}. Use ${min}–${max}${key === "textSize" ? " (0 = automático; mínimo 8)" : ""}.`,
      );
  }
  if (
    !OVERLAY_POSITIONS.includes(next.position) ||
    !Object.hasOwn(OVERLAY_FONTS, next.font) ||
    !["left", "center", "right"].includes(next.textAlign) ||
    !["none", "fade", "slide"].includes(next.animation)
  )
    invalid("Opção de aparência inválida.");
  return next;
}
