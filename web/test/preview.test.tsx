import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { Overlay } from "../src/overlays/Overlay";
import { OverlayPreview } from "../src/overlays/OverlayPreview";
import { overlayPreviewUrl } from "../src/overlays/preview";

function renderOverlay(path: string) {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/overlays/:kind" element={<Overlay />} />
      </Routes>
    </MemoryRouter>,
  );
}

test("every overlay can be previewed without waiting for a real stream event", () => {
  const expected: Record<string, string[]> = {
    alertas: ["Marina", "R$ 25,00", "Doação"],
    chat: ["Lucas", "Bia", "Boa noite, pessoal!"],
    destaque: ["Marina", "Muito bom fazer parte desta comunidade!"],
    widgets: ["Último seguidor", "Lucas", "Última inscrição", "Bia"],
    sorteio: ["TEMOS UM VENCEDOR!", "Marina"],
  };
  for (const [kind, labels] of Object.entries(expected)) {
    const html = renderOverlay(overlayPreviewUrl(kind, "demo"));
    for (const label of labels) expect(html).toContain(label);
    expect(html).toContain("overlay-in-preview");
  }
});

test("live previews explain their empty states instead of displaying a blank frame", () => {
  for (const kind of ["alertas", "chat", "destaque", "sorteio"]) {
    const html = renderOverlay(overlayPreviewUrl(kind, "live"));
    expect(html).toContain("Pronto para receber eventos");
    expect(html).toContain('role="status"');
    expect(html).not.toContain("Marina");
  }
});

test("OBS overlays stay transparent and empty when no real event is active", () => {
  for (const kind of ["alertas", "chat", "destaque", "sorteio"]) {
    const html = renderOverlay(`/overlays/${kind}`);
    expect(html).not.toContain("Marina");
    expect(html).not.toContain("Pronto para receber eventos");
    expect(html).not.toContain("overlay-in-preview");
  }
  expect(renderOverlay("/overlays/sorteio?demo=1")).not.toContain("Marina");
});
test("embedded chat demos retain full-size appearance and require explicit example mode", () => {
  const html = renderOverlay(
    "/overlays/chat?preview=1&demo=1&embedded=1&muted=1",
  );
  expect(html).toContain("Boa noite, pessoal!");
  expect(html).not.toContain("overlay-in-preview");
  expect(html).toContain('class="overlay-chat-stack"');
  expect(html).toContain("--overlay-height:100%");
  expect(renderOverlay("/overlays/chat?embedded=1&demo=1")).not.toContain(
    "Boa noite, pessoal!",
  );
});

test("preview frames reset on changes and alert previews always use the sandbox", () => {
  const url = new URL(
    overlayPreviewUrl("alertas", "live", true),
    "http://localhost",
  );
  expect(url.searchParams.get("preview")).toBe("1");
  expect(url.searchParams.get("sandbox")).toBe("1");
  expect(url.searchParams.get("muted")).toBe("0");
  expect(url.searchParams.has("demo")).toBe(false);
  const html = renderToStaticMarkup(
    <OverlayPreview kind="sorteio" mode="demo" />,
  );
  expect(html).toContain("preview=1");
  expect(html).toContain("demo=1");
  expect(html).toContain('title="Monitor de overlay"');
});
