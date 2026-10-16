import { createContext, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { io, type Socket } from "socket.io-client";
import type { ChatMessage, ChatState } from "../lib/types";
export let adminSocket: Socket | null = null;
export const AdminSocketContext = createContext<Socket | null>(null);
export function useRealtime() {
  const client = useQueryClient();
  const [connected, setConnected] = useState(false);
  const [currentSocket, setCurrentSocket] = useState<Socket | null>(null);
  useEffect(() => {
    const socket = io("/admin", { withCredentials: true });
    adminSocket = socket;
    setCurrentSocket(socket);
    socket.on("connect", () => {
      setConnected(true);
      void client.invalidateQueries();
    });
    socket.on("disconnect", () => setConnected(false));
    socket.on("connect_error", (error) => {
      setConnected(false);
      if (error.message === "Unauthorized")
        window.dispatchEvent(new Event("session-expired"));
    });
    socket.on("unauthorized", () =>
      window.dispatchEvent(new Event("session-expired")),
    );
    socket.on("chat-message", (message: ChatMessage) =>
      client.setQueryData<ChatState>(["/api/chat/state?limit=200"], (old) =>
        old
          ? {
              ...old,
              recent: [
                message,
                ...old.recent.filter((m) => m.id !== message.id),
              ].slice(0, 200),
              total: Math.min(500, old.total + 1),
            }
          : old,
      ),
    );
    socket.on("chat-featured", (featured) =>
      client.setQueryData<ChatState>(["/api/chat/state?limit=200"], (old) =>
        old ? { ...old, featured } : old,
      ),
    );
    socket.on("chat-options", (options) =>
      client.setQueryData<ChatState>(["/api/chat/state?limit=200"], (old) =>
        old ? { ...old, options } : old,
      ),
    );
    socket.on("chat-removed", ({ ids }: { ids: string[] }) =>
      client.setQueryData<ChatState>(["/api/chat/state?limit=200"], (old) =>
        old
          ? {
              ...old,
              recent: old.recent.filter((m) => !ids.includes(m.id)),
              featured:
                old.featured && ids.includes(old.featured.id)
                  ? null
                  : old.featured,
            }
          : old,
      ),
    );
    socket.on("sorteios-state", (state) =>
      client.setQueryData(["/api/sorteios/state"], { ok: true, state }),
    );
    socket.on("session-summary-update", (summary) => {
      client.setQueryData(["/api/session/summary"], summary);
      void client.invalidateQueries({
        predicate: (q) => String(q.queryKey[0]).startsWith("/api/analytics/"),
      });
    });
    socket.on(
      "alert-history-update",
      () =>
        void client.invalidateQueries({
          predicate: (q) =>
            String(q.queryKey[0]).startsWith("/api/alert-history"),
        }),
    );
    return () => {
      socket.disconnect();
      adminSocket = null;
    };
  }, [client]);
  return { connected, socket: currentSocket };
}
