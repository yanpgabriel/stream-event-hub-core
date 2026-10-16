import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import qrcode from "qrcode-generator";
import {
  cameraGeometry,
  DEFAULT_LAYOUT,
  DEFAULT_RUNTIME,
  type SceneSnapshot,
} from "../../../shared/presentation.mjs";
import type { ChatMessage } from "../lib/types";
import "./scene.css";

export function demoScene(): SceneSnapshot {
  return {
    layout: structuredClone(DEFAULT_LAYOUT),
    runtime: {
      ...structuredClone(DEFAULT_RUNTIME),
      goalCurrent: 42,
      timerStartedAt: Date.now() - 3661000,
    },
    currentGoal: 42,
    statValue: "Lucas",
    activity: [
      {
        id: "demo1",
        name: "Marina",
        label: "Nova inscrição",
        source: "automatic",
      },
      { id: "demo2", name: "Bia", label: "Novo seguidor", source: "automatic" },
    ],
    revision: 0,
  };
}
export const demoChat: ChatMessage[] = [
  {
    id: "demo1",
    chatname: "Marina",
    chatmessage: "Boa noite, comunidade! ✨",
    source: "youtube",
    timestamp: new Date().toISOString(),
  },
  {
    id: "demo2",
    chatname: "Lucas",
    chatmessage: "Vamos para mais uma live!",
    source: "twitch",
    timestamp: new Date().toISOString(),
  },
];

function ScreenMessage({ text, effect }: { text: string; effect: string }) {
  const [visible, setVisible] = useState(effect === "typing" ? "" : text);
  useEffect(() => {
    if (effect !== "typing") {
      setVisible(text);
      return;
    }
    const letters = Array.from(text);
    let n = 0;
    setVisible("");
    const timer = setInterval(() => {
      setVisible(letters.slice(0, ++n).join(""));
      if (n >= letters.length) clearInterval(timer);
    }, 60);
    return () => clearInterval(timer);
  }, [text, effect]);
  return (
    <div className={`scene-screen-message effect-${effect}`}>
      <span data-text={visible}>
        {visible}
        {effect === "typing" && <i>_</i>}
      </span>
    </div>
  );
}

export function SceneCanvas({
  snapshot,
  messages = [],
  connected = true,
  demo = false,
}: {
  snapshot: SceneSnapshot;
  messages?: ChatMessage[];
  connected?: boolean;
  demo?: boolean;
}) {
  const { layout: l, runtime: r } = snapshot;
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (!r.timerStartedAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [r.timerStartedAt]);
  const elapsed = Math.max(
    0,
    r.timerElapsedMs + (r.timerStartedAt ? now - r.timerStartedAt : 0),
  );
  const seconds = Math.floor(elapsed / 1000);
  const uptime = [
    Math.floor(seconds / 3600),
    Math.floor(seconds / 60) % 60,
    seconds % 60,
  ]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
  const qr = useMemo(() => {
    if (!l.qr.enabled || !l.qr.text) return "";
    try {
      qrcode.stringToBytes = (text) =>
        Array.from(new TextEncoder().encode(text));
      const code = qrcode(0, "M");
      code.addData(l.qr.text);
      code.make();
      return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(code.createSvgTag({ cellSize: 4, margin: 8 }))}`;
    } catch {
      return "";
    }
  }, [l.qr.enabled, l.qr.text]);
  const cam = cameraGeometry(l).outer;
  const chatTop =
    l.webcam.enabled && l.webcam.corner === "top-left"
      ? cam.y +
        cam.height +
        (l.webcam.showLabel && l.webcam.label.trim() ? 55 : 20)
      : 180;
  const progress = Math.min(
    100,
    Math.max(0, (snapshot.currentGoal / l.goal.target) * 100),
  );
  const label = l.stat.source === "manual" ? l.stat.value : snapshot.statValue;
  return (
    <div
      className={`scene-canvas ${l.theme.flicker ? "scene-flicker" : ""}`}
      style={
        {
          width: l.canvas.width,
          height: l.canvas.height,
          "--scene-accent": l.theme.color,
        } as CSSProperties
      }
    >
      {l.theme.vignette && <div className="scene-vignette" />}
      {l.theme.particles && (
        <div className="scene-particles" aria-hidden="true">
          {Array.from({ length: 30 }, (_, i) => (
            <i
              key={i}
              style={{
                left: `${(i * 37) % 100}%`,
                width: 2 + (i % 4),
                height: 2 + (i % 4),
                animationDelay: `-${i % 9}s`,
                animationDuration: `${7 + (i % 5)}s`,
              }}
            />
          ))}
        </div>
      )}
      {l.topbar.enabled && (
        <div className="scene-topbar">
          {l.topbar.showStat && (
            <div>
              <small>{l.stat.label}</small>
              <strong>{label || "Seja o primeiro"}</strong>
            </div>
          )}
          {l.topbar.showGoal && (
            <div>
              <small>{l.goal.label}</small>
              <strong>
                {snapshot.currentGoal.toLocaleString("pt-BR")} /{" "}
                {l.goal.target.toLocaleString("pt-BR")}
              </strong>
              <div className="scene-goal-track">
                <i style={{ width: `${progress}%` }} />
              </div>
            </div>
          )}
          {l.topbar.socialValue && (
            <div>
              <small>{l.topbar.socialLabel}</small>
              <strong>{l.topbar.socialValue}</strong>
            </div>
          )}
          {(r.timerStartedAt || r.timerElapsedMs > 0) && (
            <div>
              <small>{r.timerStartedAt ? "No ar" : "Tempo pausado"}</small>
              <strong>{uptime}</strong>
            </div>
          )}
        </div>
      )}
      {l.webcam.enabled && (
        <div
          className="scene-camera"
          style={{
            left: cam.x,
            top: cam.y,
            width: cam.width,
            height: cam.height,
            borderWidth: l.webcam.padding,
          }}
        >
          {l.webcam.showLabel && l.webcam.label.trim() && (
            <span>{l.webcam.label}</span>
          )}
        </div>
      )}
      {l.chat.enabled && (
        <div
          className={`scene-chat${l.chat.mode === "overlay" ? " scene-chat-embedded" : ""}`}
          style={{
            top: chatTop,
            ...(l.chat.mode === "overlay"
              ? {
                  width: Math.min(l.chat.overlayWidth, l.canvas.width - 120),
                  height: Math.min(
                    l.chat.overlayHeight,
                    Math.max(0, l.canvas.height - chatTop - 60),
                  ),
                }
              : {}),
          }}
        >
          {l.chat.mode === "overlay" ? (
            <iframe
              title="Chat da composição (overlay)"
              src={
                demo
                  ? "/overlays/chat?muted=1&preview=1&demo=1&embedded=1"
                  : "/overlays/chat?muted=1"
              }
              tabIndex={-1}
            />
          ) : (
            <>
              <h4>// CHAT DA LIVE</h4>
              {messages
                .slice(0, l.chat.limit)
                .reverse()
                .map((m) => (
                  <div className="scene-chat-message" key={m.id}>
                    <strong>{m.chatname}</strong>
                    <p style={{ fontSize: l.chat.textSize }}>{m.chatmessage}</p>
                  </div>
                ))}
            </>
          )}
        </div>
      )}
      {l.activity.enabled && (
        <div className="scene-activity">
          <h4>// ATIVIDADE RECENTE</h4>
          {snapshot.activity.slice(0, l.activity.limit).map((item) => (
            <div key={item.id}>
              <strong>{item.name}</strong>
              <span>{item.label}</span>
            </div>
          ))}
        </div>
      )}
      {l.ticker.enabled && l.ticker.text && (
        <div className="scene-ticker">
          <div style={{ animationDuration: `${l.ticker.speed}s` }}>
            {[0, 1, 2].map((i) => (
              <span key={i}>{l.ticker.text}　•　</span>
            ))}
          </div>
        </div>
      )}
      {qr && (
        <div className="scene-qr">
          <img src={qr} alt="QR Code da transmissão" width={150} height={150} />
        </div>
      )}
      {l.qr.enabled && l.qr.text && !qr && (
        <div className="scene-qr">Conteúdo do QR inválido ou muito longo.</div>
      )}
      {l.message.enabled && l.message.text && (
        <ScreenMessage text={l.message.text} effect={l.message.effect} />
      )}
      {!connected && l.connection.behavior === "warning" && (
        <div className="scene-offline">
          <strong>SINAL PERDIDO</strong>
          <p>Tentando reconectar ao painel…</p>
        </div>
      )}
    </div>
  );
}

export function SceneViewport(props: {
  snapshot: SceneSnapshot;
  messages?: ChatMessage[];
  connected?: boolean;
  demo?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ scale: 0.2, x: 0, y: 0 });
  const width = Math.max(1, props.snapshot.layout.canvas.width);
  const height = Math.max(1, props.snapshot.layout.canvas.height);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      const scale = Math.min(rect.width / width, rect.height / height);
      setBox({
        scale,
        x: (rect.width - width * scale) / 2,
        y: (rect.height - height * scale) / 2,
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [width, height]);
  return (
    <div
      ref={ref}
      className="scene-viewport"
      style={{ aspectRatio: `${width} / ${height}` }}
    >
      <div
        className="scene-scaled"
        style={{ left: box.x, top: box.y, transform: `scale(${box.scale})` }}
      >
        <SceneCanvas {...props} />
      </div>
    </div>
  );
}
