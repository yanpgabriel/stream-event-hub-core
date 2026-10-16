import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { SceneCanvas, demoChat, demoScene } from "../src/overlays/SceneCanvas";
import { SceneOverlay } from "../src/overlays/SceneOverlay";
import { goalValue } from "../../shared/presentation.mjs";

test("full composition renders all migrated content and a locally generated QR", () => {
  const snapshot = demoScene();
  snapshot.layout.qr = {
    enabled: true,
    text: "https://example.com/apoio?nome=ação",
  };
  snapshot.layout.message = {
    enabled: true,
    text: "Já volto!",
    effect: "glitch",
  };
  snapshot.layout.topbar.socialValue = "@meucanal";
  const html = renderToStaticMarkup(
    <SceneCanvas snapshot={snapshot} messages={demoChat} />,
  );
  for (const text of [
    "CHAT DA LIVE",
    "Marina",
    "ATIVIDADE RECENTE",
    "LIVE ONLINE",
    "Meta de Subs",
    "42 / 50",
    "@meucanal",
    "Já volto!",
    "effect-glitch",
    "QR Code da transmissão",
    "data:image/svg+xml",
  ])
    expect(html).toContain(text);
  expect(html).not.toContain("iframe");
});
test("hidden elements are absent and connection warning is a user choice", () => {
  const snapshot = demoScene();
  snapshot.layout.chat.enabled = false;
  snapshot.layout.webcam.enabled = false;
  snapshot.layout.activity.enabled = false;
  snapshot.layout.theme.particles = false;
  snapshot.layout.ticker.enabled = false;
  let html = renderToStaticMarkup(
    <SceneCanvas snapshot={snapshot} connected={false} />,
  );
  for (const name of [
    "scene-camera",
    "scene-chat",
    "scene-activity",
    "scene-particles",
    "scene-ticker",
    "SINAL PERDIDO",
  ])
    expect(html).not.toContain(name);
  snapshot.layout.connection.behavior = "warning";
  html = renderToStaticMarkup(
    <SceneCanvas snapshot={snapshot} connected={false} />,
  );
  expect(html).toContain("SINAL PERDIDO");
});
test("webcam caption can be hidden without hiding the frame or forgetting its text", () => {
  const snapshot = demoScene();
  snapshot.layout.webcam.showLabel = false;
  let html = renderToStaticMarkup(<SceneCanvas snapshot={snapshot} />);
  expect(html).toContain('class="scene-camera"');
  expect(html).not.toContain("LIVE ONLINE");
  expect(snapshot.layout.webcam.label).toBe("LIVE ONLINE");
  snapshot.layout.webcam.showLabel = true;
  html = renderToStaticMarkup(<SceneCanvas snapshot={snapshot} />);
  expect(html).toContain("LIVE ONLINE");
  snapshot.layout.webcam.label = "   ";
  html = renderToStaticMarkup(<SceneCanvas snapshot={snapshot} />);
  expect(html).not.toContain("<span>   </span>");
});
test("composition can embed the standalone chat on the current origin without duplicating native messages", () => {
  const snapshot = demoScene();
  snapshot.layout.chat.mode = "overlay";
  snapshot.layout.chat.overlayWidth = 460;
  snapshot.layout.chat.overlayHeight = 600;
  let html = renderToStaticMarkup(
    <SceneCanvas snapshot={snapshot} messages={demoChat} />,
  );
  expect(html).toContain("scene-chat-embedded");
  expect(html).toContain('title="Chat da composição (overlay)"');
  expect(html).toContain('src="/overlays/chat?muted=1"');
  expect(html).toContain("width:460px;height:600px");
  expect(html).not.toContain("localhost:5173");
  expect(html).not.toContain("scene-chat-message");
  expect(html).not.toContain("CHAT DA LIVE");
  expect(html).not.toContain("demo=1");
  html = renderToStaticMarkup(<SceneCanvas snapshot={snapshot} demo />);
  expect(html).toContain("preview=1&amp;demo=1&amp;embedded=1");
  snapshot.layout.chat.enabled = false;
  html = renderToStaticMarkup(<SceneCanvas snapshot={snapshot} demo />);
  expect(html).not.toContain("iframe");
});
test("embedded chat dimensions stay within the available canvas area", () => {
  const snapshot = demoScene();
  snapshot.layout.chat.mode = "overlay";
  snapshot.layout.chat.overlayWidth = 3840;
  snapshot.layout.chat.overlayHeight = 2160;
  const html = renderToStaticMarkup(<SceneCanvas snapshot={snapshot} />);
  expect(html).toContain("top:180px;width:1800px;height:840px");
});
test("composition demos are explicit and production does not render fictional content", () => {
  const demo = renderToStaticMarkup(
    <MemoryRouter initialEntries={["/overlays/cena?preview=1&demo=1"]}>
      <SceneOverlay />
    </MemoryRouter>,
  );
  expect(demo).toContain("scene-canvas");
  expect(demo).toContain("Marina");
  const production = renderToStaticMarkup(
    <MemoryRouter initialEntries={["/overlays/cena"]}>
      <SceneOverlay />
    </MemoryRouter>,
  );
  expect(production).not.toContain("Marina");
});
test("automatic goals add only the chosen session metric to the manual adjustment", () => {
  const snapshot = demoScene();
  snapshot.runtime.goalCurrent = 2;
  snapshot.layout.goal.mode = "twitchSubs";
  expect(
    goalValue(snapshot.layout, snapshot.runtime, { twitchSubs: { total: 5 } }),
  ).toBe(7);
  snapshot.layout.goal.mode = "donations";
  expect(
    goalValue(snapshot.layout, snapshot.runtime, {
      youtubeTips: { totalBrlMinor: 1234 },
      livepixTips: { totalBrlMinor: 566 },
    }),
  ).toBe(20);
  snapshot.layout.goal.mode = "manual";
  expect(
    goalValue(snapshot.layout, snapshot.runtime, { twitchSubs: { total: 5 } }),
  ).toBe(2);
});
