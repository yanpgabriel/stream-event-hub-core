import type { CSSProperties } from "react";
import {
  DEFAULT_APPEARANCES,
  OVERLAY_FONTS,
  type OverlayAppearance,
} from "../../../shared/overlayAppearance.mjs";

export function appearanceStyle(
  appearance: OverlayAppearance,
  sceneColor: string,
): CSSProperties {
  const accent = appearance.useSceneColor ? sceneColor : appearance.accentColor;
  const [vertical, horizontal] = appearance.position.split("-");
  const align: Record<string, string> = {
    top: "flex-start",
    bottom: "flex-end",
    left: "flex-start",
    right: "flex-end",
    center: "center",
  };
  return {
    "--overlay-accent": accent,
    "--overlay-text": appearance.textColor,
    "--overlay-background": `${appearance.backgroundColor}${Math.round(
      (appearance.backgroundOpacity * 255) / 100,
    )
      .toString(16)
      .padStart(2, "0")}`,
    "--overlay-border": `${appearance.borderWidth}px`,
    "--overlay-radius": `${appearance.borderRadius}px`,
    "--overlay-padding": `${appearance.padding}px`,
    "--overlay-margin": `${appearance.margin}px`,
    "--overlay-width": appearance.maxWidth
      ? `${appearance.maxWidth}px`
      : "100%",
    "--overlay-height": appearance.maxHeight
      ? `${appearance.maxHeight}px`
      : "100%",
    "--overlay-title": `${appearance.titleSize}px`,
    "--overlay-body": appearance.textSize
      ? `${appearance.textSize}px`
      : undefined,
    "--overlay-shadow": appearance.glow ? `0 0 28px ${accent}45` : "none",
    "--overlay-animation":
      appearance.animation === "none"
        ? "none"
        : `${appearance.animation === "slide" ? "overlay-slide" : "appear"} .3s ease-out`,
    fontFamily: OVERLAY_FONTS[appearance.font],
    textAlign: appearance.textAlign as CSSProperties["textAlign"],
    alignItems: align[horizontal],
    justifyContent: align[vertical],
  } as CSSProperties;
}

export function defaultAppearance(kind: string | undefined) {
  return (
    DEFAULT_APPEARANCES[kind as keyof typeof DEFAULT_APPEARANCES] ||
    DEFAULT_APPEARANCES.alertas
  );
}
