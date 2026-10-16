import { useContext, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AdminSocketContext } from "../../app/realtime";
import { useApi } from "../../lib/hooks";
import { api } from "../../lib/api";
import { useToast } from "../../components/ui";
import type {
  SceneLayout,
  SceneRuntime,
} from "../../../../shared/presentation.mjs";
import type { AppearanceState } from "../../../../shared/overlayAppearance.mjs";
export interface Preset {
  id: string;
  name: string;
  scene: string;
  layout: SceneLayout;
}
export interface PresentationState {
  revision: number;
  draft: SceneLayout;
  published: SceneLayout;
  runtime: SceneRuntime;
  presets: Preset[];
  pendingRuntime?: Partial<SceneRuntime> | null;
  appearances: AppearanceState;
}
export function usePresentation() {
  const query = useApi<PresentationState>("/api/overlay/config");
  const client = useQueryClient();
  const socket = useContext(AdminSocketContext);
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let revision = -1;
    function update(snapshot: { revision: number }) {
      client.setQueryData(["/api/overlay/state"], snapshot);
      if (snapshot.revision !== revision) {
        revision = snapshot.revision;
        void client.invalidateQueries({ queryKey: ["/api/overlay/config"] });
      }
    }
    socket?.on("overlay:state", update);
    return () => {
      socket?.off("overlay:state", update);
    };
  }, [client, socket]);
  async function execute(
    path: string,
    body: unknown = {},
    method = "POST",
    message = "Alteração salva.",
  ) {
    setBusy(true);
    try {
      const data = await api(path, { method, body: JSON.stringify(body) });
      if (data?.draft) client.setQueryData(["/api/overlay/config"], data);
      if (data?.state) client.setQueryData(["/api/overlay/config"], data.state);
      await client.invalidateQueries({
        predicate: (q) =>
          String(q.queryKey[0]).startsWith("/api/overlay/") ||
          String(q.queryKey[0]).startsWith("/api/obs/"),
      });
      toast(data?.warning || message, data?.warning ? "error" : "success");
      return data;
    } catch (error) {
      toast((error as Error).message, "error");
      throw error;
    } finally {
      setBusy(false);
    }
  }
  return { ...query, busy, execute };
}
