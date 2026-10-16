import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  DEFAULT_APPEARANCES,
  OVERLAY_KINDS,
  validateAppearance,
} from "../../shared/overlayAppearance.mjs";
import { appearanceStyle } from "../src/overlays/appearance";
import { OverlayPreview } from "../src/overlays/OverlayPreview";

test("all five overlay styles support color, transparent background, typography and positioning", () => {
  for (const kind of OVERLAY_KINDS) {
    const appearance = validateAppearance(kind, {
      accentColor: "#123456",
      backgroundOpacity: 0,
      textSize: 28,
      titleSize: 40,
      position: "top-right",
      font: "mono",
      glow: false,
      animation: "none",
      maxHeight: 420,
    });
    const style = appearanceStyle(appearance, "#ffffff") as Record<
      string,
      unknown
    >;
    expect(style["--overlay-accent"]).toBe("#123456");
    expect(style["--overlay-background"]).toBe("#15131e00");
    expect(style["--overlay-title"]).toBe("40px");
    expect(style["--overlay-body"]).toBe("28px");
    expect(style.alignItems).toBe("flex-end");
    expect(style.justifyContent).toBe("flex-start");
    expect(style.fontFamily).toContain("Consolas");
    expect(style["--overlay-shadow"]).toBe("none");
    expect(style["--overlay-animation"]).toBe("none");
    expect(style["--overlay-height"]).toBe("420px");
    expect(DEFAULT_APPEARANCES[kind].accentColor).toBe("#bb98eb");
  }
});

test("scene color inheritance follows the published theme and automatic sizing keeps existing alert/chat settings", () => {
  const config = validateAppearance("chat", {
    useSceneColor: true,
    backgroundOpacity: 100,
  });
  const style = appearanceStyle(config, "#ff0000") as Record<string, unknown>;
  expect(style["--overlay-accent"]).toBe("#ff0000");
  expect(
    appearanceStyle(config, "#00ff00")[
      "--overlay-accent" as keyof React.CSSProperties
    ],
  ).toBe("#00ff00");
  expect(style["--overlay-background"]).toBe("#15131eff");
  expect(style["--overlay-body"]).toBeUndefined();
  expect(config.titleSize).toBe(14);
  expect(style["--overlay-height"]).toBe("100%");
});

test("maximum height accepts automatic or bounded pixels and fills defaults for older appearances", () => {
  for (const kind of OVERLAY_KINDS) {
    for (const maxHeight of [0, 1, 720, 2160])
      expect(validateAppearance(kind, { maxHeight }).maxHeight).toBe(maxHeight);
    for (const maxHeight of [-1, 2161, 1.5, Infinity, NaN, "200"])
      expect(() => validateAppearance(kind, { maxHeight })).toThrow();
    const { maxHeight: _oldMissingHeight, ...older } =
      DEFAULT_APPEARANCES[kind];
    expect(validateAppearance(kind, older).maxHeight).toBe(0);
  }
});

test("draft preview settings are not placed in the public URL or forwarded as real events", () => {
  const html = renderToStaticMarkup(
    <OverlayPreview
      kind="alertas"
      mode="demo"
      appearance={{ ...DEFAULT_APPEARANCES.alertas, accentColor: "#123abc" }}
    />,
  );
  expect(html).toContain("demo=1");
  expect(html).toContain("muted=1");
  expect(html).not.toContain("#123abc");
  expect(html).not.toContain("appearance=");
});
