import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { io } from "socket.io-client";
import { api } from "../lib/api";
import type { ChatMessage, ChatState } from "../lib/types";
import type { SceneSnapshot } from "../../../shared/presentation.mjs";
import { demoChat, demoScene, SceneViewport } from "./SceneCanvas";

export function SceneOverlay() {
  const [params] = useSearchParams();
  const demo = params.get("preview") === "1" && params.get("demo") === "1";
  const examples = useMemo(demoScene, []);
  const [snapshot, setSnapshot] = useState<SceneSnapshot | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    document.documentElement.classList.add("transparent-overlay");
    return () =>
      document.documentElement.classList.remove("transparent-overlay");
  }, []);
  useEffect(() => {
    if (demo) return;
    const socket = io("/");
    let active = true;
    const accept = (data: SceneSnapshot) => {
      if (active)
        setSnapshot((old) =>
          !old || data.revision >= old.revision ? data : old,
        );
    };
    socket.on("connect", () => {
      setConnected(true);
      void api<SceneSnapshot>("/api/overlay/state")
        .then(accept)
        .catch(() => {});
    });
    socket.on("disconnect", () => setConnected(false));
    socket.on("connect_error", () => setConnected(false));
    socket.on("overlay:state", accept);
    socket.on("chat-state", (state: ChatState) => setMessages(state.recent));
    socket.on("chat-message", (message: ChatMessage) =>
      setMessages((old) =>
        [message, ...old.filter((m) => m.id !== message.id)].slice(0, 30),
      ),
    );
    socket.on("chat-removed", ({ ids }: { ids: string[] }) =>
      setMessages((old) => old.filter((m) => !ids.includes(m.id))),
    );
    const expiry = setInterval(
      () =>
        setMessages((old) =>
          old.filter((m) => Date.parse(m.timestamp) > Date.now() - 1800000),
        ),
      15000,
    );
    return () => {
      active = false;
      clearInterval(expiry);
      socket.disconnect();
    };
  }, [demo]);
  const value = demo ? examples : snapshot;
  return (
    <div className="scene-live-root">
      {value ? (
        <SceneViewport
          snapshot={value}
          messages={demo ? demoChat : messages}
          connected={demo || connected}
          demo={demo}
        />
      ) : params.get("preview") === "1" ? (
        <div className="overlay-preview-waiting">
          Aguardando a composição do servidor…
        </div>
      ) : null}
    </div>
  );
}
