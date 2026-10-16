import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { io } from "socket.io-client";
import { api } from "../lib/api";
import {
  alertNames,
  type AlertPayload,
  type AlertType,
  type ChatMessage,
  type Data,
} from "../lib/types";
import { createVisualQueue } from "./queue";
import { speakText } from "./audio";
import { createOverlayExamples, previewWaitingMessages } from "./preview";
import {
  validateAppearance,
  type OverlayAppearance,
  type OverlayAppearances,
} from "../../../shared/overlayAppearance.mjs";
import { appearanceStyle, defaultAppearance } from "./appearance";

const listenerType: Record<string, AlertType> = {
  "follower-latest": "follow",
  "subscriber-latest": "sub",
  "tip-latest": "tip",
  "cheer-latest": "cheer",
  "raid-latest": "raid",
};
export function Overlay() {
  const { kind } = useParams();
  const [params] = useSearchParams();
  const sandbox = params.get("sandbox") === "1";
  const muted = params.get("muted") === "1";
  const preview = params.get("preview") === "1";
  const compactPreview = preview && params.get("embedded") !== "1";
  const demo = preview && params.get("demo") === "1";
  const examples = useMemo(createOverlayExamples, []);
  const [alert, setAlert] = useState<AlertPayload | null>(null);
  const [featured, setFeatured] = useState<ChatMessage | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [options, setOptions] = useState<Data>({});
  const [widgets, setWidgets] = useState<Data>({});
  const [winner, setWinner] = useState<string | null>(null);
  const [audioError, setAudioError] = useState(false);
  const retryAudio = useRef<(() => void) | null>(null);
  const [connection, setConnection] = useState("connecting");
  const [presentation, setPresentation] = useState<{
    revision: number;
    layout: { theme: { color: string } };
    appearances?: OverlayAppearances;
  } | null>(null);
  const [draftAppearance, setDraftAppearance] = useState<{
    kind: string;
    appearance: OverlayAppearance;
    sceneColor: string;
  } | null>(null);
  useEffect(() => {
    if (!demo) return;
    function receive(event: MessageEvent) {
      if (
        event.origin !== window.location.origin ||
        event.source !== window.parent ||
        window.parent === window ||
        event.data?.type !== "overlay:appearance-preview" ||
        event.data.kind !== kind
      )
        return;
      try {
        if (!/^#[a-f0-9]{6}$/i.test(event.data.sceneColor)) return;
        setDraftAppearance({
          kind: kind || "",
          appearance: validateAppearance(kind || "", event.data.appearance),
          sceneColor: event.data.sceneColor,
        });
      } catch {
        /* Ignore malformed preview messages; never persist them. */
      }
    }
    window.addEventListener("message", receive);
    if (window.parent !== window)
      window.parent.postMessage(
        { type: "overlay:appearance-ready" },
        window.location.origin,
      );
    return () => window.removeEventListener("message", receive);
  }, [kind, demo]);
  useEffect(() => {
    document.documentElement.classList.add("transparent-overlay");
    return () =>
      document.documentElement.classList.remove("transparent-overlay");
  }, []);
  useEffect(() => {
    const socket = io("/", { withCredentials: false });
    let active = true;
    const accept: (data: NonNullable<typeof presentation>) => void = (data) => {
      if (active)
        setPresentation((old) =>
          !old || data.revision >= old.revision ? data : old,
        );
    };
    socket.on("overlay:state", accept);
    socket.on("connect", () => {
      void api<NonNullable<typeof presentation>>("/api/overlay/state")
        .then(accept)
        .catch(() => {});
    });
    if (demo)
      return () => {
        active = false;
        socket.disconnect();
      };
    socket.on("connect", () => setConnection("connected"));
    socket.on("disconnect", () => setConnection("disconnected"));
    socket.on("connect_error", () => setConnection("disconnected"));
    let audio: HTMLAudioElement | null = null;
    let speech: AbortController | null = null;
    let winnerTimer: ReturnType<typeof setTimeout>;
    let expiryTimer: ReturnType<typeof setInterval>;
    const queue = createVisualQueue<AlertPayload>({
      duration: (item) =>
        Math.max(2, Math.min(30, item.alertDuration || 6)) * 1000,
      start: (item) => {
        setAlert(item);
        setAudioError(false);
        if (muted) return;
        speech = new AbortController();
        const type = listenerType[item.listener];
        if (item.sound?.url) {
          audio = new Audio(item.sound.url);
          audio.volume = Math.max(
            0,
            Math.min(1, (item.sound.volume ?? 80) / 100),
          );
          const play = () =>
            void audio?.play().catch(() => {
              setAudioError(true);
              retryAudio.current = play;
            });
          play();
        }
        if (item.tts?.enabled[type])
          void speakText(
            String(item.event.message || ""),
            item.tts,
            speech.signal,
          ).catch((error) => {
            if (error.name !== "AbortError") setAudioError(true);
          });
      },
      finish: () => {
        setAlert(null);
        audio?.pause();
        audio = null;
        speech?.abort();
        speech = null;
        retryAudio.current = null;
      },
    });
    if (kind === "alertas")
      socket.on(sandbox ? "event:sandbox" : "event", (item: AlertPayload) =>
        queue.push(item),
      );
    function widgetLoad() {
      if (kind === "widgets")
        void api("/api/widget-data")
          .then(setWidgets)
          .catch(() => {});
    }
    socket.on("connect", widgetLoad);
    socket.on("widget-update", setWidgets);
    socket.on("chat-state", (state) => {
      setMessages(state.recent || []);
      setFeatured(state.featured);
      setOptions(state.options || {});
    });
    socket.on("chat-message", (message: ChatMessage) =>
      setMessages((old) =>
        [message, ...old.filter((m) => m.id !== message.id)].slice(0, 100),
      ),
    );
    socket.on("chat-featured", setFeatured);
    socket.on("chat-options", setOptions);
    socket.on("chat-removed", ({ ids }: { ids: string[] }) => {
      setMessages((old) => old.filter((m) => !ids.includes(m.id)));
      setFeatured((old) => (old && ids.includes(old.id) ? null : old));
    });
    socket.on("sorteio-winner", (data: { name: string }) => {
      setWinner(data.name);
      clearTimeout(winnerTimer);
      winnerTimer = setTimeout(() => setWinner(null), 8000);
    });
    expiryTimer = setInterval(
      () =>
        setMessages((old) =>
          old.filter(
            (m) => Date.parse(m.timestamp) > Date.now() - 30 * 60 * 1000,
          ),
        ),
      15000,
    );
    return () => {
      active = false;
      socket.disconnect();
      queue.dispose();
      clearTimeout(winnerTimer);
      clearInterval(expiryTimer);
    };
  }, [kind, sandbox, muted, demo]);
  const view = demo
    ? examples
    : { alert, featured, messages, options, widgets, winner };
  const previewDraft =
    demo && draftAppearance?.kind === kind ? draftAppearance : null;
  const appearance =
    previewDraft?.appearance ||
    presentation?.appearances?.[kind as keyof OverlayAppearances] ||
    defaultAppearance(kind);
  const style = appearanceStyle(
    appearance,
    previewDraft?.sceneColor || presentation?.layout.theme.color || "#39ff14",
  );
  const pageClass = `overlay-page overlay-styled${compactPreview ? " overlay-in-preview" : ""}`;
  const visible =
    kind === "alertas"
      ? !!view.alert
      : kind === "chat"
        ? !!view.messages.length
        : kind === "destaque"
          ? !!view.featured
          : kind === "sorteio"
            ? !!view.winner
            : true;
  if (preview && !visible)
    return (
      <div className="overlay-preview-waiting" role="status">
        <div className="preview-waiting-icon">◌</div>
        <strong>
          {connection === "disconnected"
            ? "Reconectando ao servidor…"
            : "Pronto para receber eventos"}
        </strong>
        <p>{previewWaitingMessages[kind || ""]}</p>
      </div>
    );
  if (kind === "chat")
    return (
      <div className={`${pageClass} overlay-chat`} style={style}>
        <div className="overlay-chat-stack">
          {view.messages
            .slice(0, compactPreview ? 3 : 5)
            .reverse()
            .map((m) => (
              <div className="chat-bubble" key={m.id}>
                <strong>{m.chatname}</strong>
                <p
                  style={{
                    fontSize:
                      appearance.textSize ||
                      view.options.chatMessageTextSize ||
                      20,
                  }}
                >
                  {m.chatmessage}
                </p>
              </div>
            ))}
        </div>
      </div>
    );
  if (kind === "destaque")
    return (
      <div className={pageClass} style={style}>
        {view.featured && (
          <div className="alert-box">
            <div className="eyebrow">{view.featured.chatname}</div>
            <p
              style={{
                fontSize:
                  appearance.textSize ||
                  view.options.featureMessageTextSize ||
                  48,
              }}
            >
              {view.featured.chatmessage}
            </p>
          </div>
        )}
      </div>
    );
  if (kind === "widgets")
    return (
      <div className={pageClass} style={style}>
        <div className="widget-box">
          <div>
            <small>Último seguidor</small>
            <strong>{view.widgets.lastFollower || "Seja o primeiro"}</strong>
          </div>
          <div>
            <small>Última inscrição</small>
            <strong>{view.widgets.lastSub || "Seja o primeiro"}</strong>
          </div>
        </div>
      </div>
    );
  if (kind === "sorteio")
    return (
      <div className={pageClass} style={style}>
        {view.winner && (
          <div className="alert-box">
            <div className="eyebrow">TEMOS UM VENCEDOR!</div>
            <h1>{view.winner}</h1>
            <p>A sorte estava do seu lado.</p>
          </div>
        )}
      </div>
    );
  if (kind !== "alertas")
    return (
      <div className={pageClass} style={style}>
        <p>Overlay não encontrado.</p>
      </div>
    );
  return (
    <div className={pageClass} style={style}>
      {view.alert && (
        <div className="alert-box" role="status">
          <div className="eyebrow">
            {alertNames[listenerType[view.alert.listener]] || "Novo evento"}
          </div>
          <h1>{view.alert.event.name || "Anônimo"}</h1>
          {view.alert.event.amount && (
            <strong>{String(view.alert.event.amount)}</strong>
          )}
          {view.alert.event.message && (
            <p
              style={{
                fontSize:
                  appearance.textSize || view.alert.alertMessageTextSize || 32,
                margin: 0,
              }}
            >
              {view.alert.event.message}
            </p>
          )}
          {audioError && sandbox && (
            <button
              onClick={() => {
                setAudioError(false);
                retryAudio.current?.();
              }}
            >
              Habilitar áudio
            </button>
          )}
        </div>
      )}
    </div>
  );
}
