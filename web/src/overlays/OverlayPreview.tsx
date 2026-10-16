import { overlayPreviewUrl, type PreviewMode } from "./preview";
import { useEffect, useRef } from "react";
import type { OverlayAppearance } from "../../../shared/overlayAppearance.mjs";

export function OverlayPreview({
  kind,
  mode = "live",
  sound = false,
  title = "Monitor de overlay",
  appearance,
  sceneColor = "#39ff14",
}: {
  kind: string;
  mode?: PreviewMode;
  sound?: boolean;
  title?: string;
  appearance?: OverlayAppearance;
  sceneColor?: string;
}) {
  const src = overlayPreviewUrl(kind, mode, sound);
  const frame = useRef<HTMLIFrameElement>(null);
  function sendPreview() {
    if (appearance && mode === "demo")
      frame.current?.contentWindow?.postMessage(
        {
          type: "overlay:appearance-preview",
          kind,
          appearance,
          sceneColor,
        },
        window.location.origin,
      );
  }
  useEffect(() => {
    sendPreview();
    function ready(event: MessageEvent) {
      if (
        event.origin === window.location.origin &&
        event.source === frame.current?.contentWindow &&
        event.data?.type === "overlay:appearance-ready"
      )
        sendPreview();
    }
    window.addEventListener("message", ready);
    return () => window.removeEventListener("message", ready);
  }, [appearance, kind, mode, sceneColor]);
  return (
    <iframe
      ref={frame}
      key={src}
      title={title}
      className="overlay-preview"
      src={src}
      allow="autoplay"
      onLoad={sendPreview}
    />
  );
}
