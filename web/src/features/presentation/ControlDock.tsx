import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import {
  Card,
  ErrorState,
  Field,
  Loading,
  Select,
  Toggle,
} from "../../components/ui";
import { useSession } from "../../app/session";
import { useRealtime, AdminSocketContext } from "../../app/realtime";
import { usePresentation } from "./usePresentation";
import { RuntimeControls } from "./RuntimeControls";
import type { SceneLayout } from "../../../../shared/presentation.mjs";

function DockContent() {
  const query = usePresentation();
  const [message, setMessage] = useState("");
  const [effect, setEffect] = useState("pulse");
  useEffect(() => {
    if (query.data) {
      setMessage(query.data.published.message.text);
      setEffect(query.data.published.message.effect);
    }
  }, [
    query.data?.published.message.text,
    query.data?.published.message.effect,
  ]);
  if (!query.data)
    return query.error ? <ErrorState error={query.error} /> : <Loading />;
  const { published: p, revision } = query.data;
  const elements: [keyof SceneLayout, string][] = [
    ["webcam", "Webcam"],
    ["topbar", "Barra superior"],
    ["chat", "Chat"],
    ["activity", "Atividade"],
    ["ticker", "Letreiro"],
    ["qr", "QR Code"],
  ];
  return (
    <div className="scene-dock">
      <h1>Controle da live</h1>
      <p>As ações deste painel afetam a composição publicada.</p>
      <Card title="Elementos ao vivo">
        {elements.map(([group, label]) => (
          <Toggle
            key={group}
            label={label}
            checked={(p[group] as unknown as { enabled: boolean }).enabled}
            onChange={(enabled) => {
              if (query.busy) return;
              void query
                .execute("/api/overlay/live", {
                  revision,
                  patch: { [group]: { enabled } },
                })
                .catch(() => {});
            }}
          />
        ))}
      </Card>
      <Card title="Mensagem de tela cheia" className="section-gap">
        <Field
          label="Texto"
          value={message}
          maxLength={2000}
          onChange={(e) => setMessage(e.target.value)}
        />
        <Select label="Efeito" value={effect} onChange={setEffect}>
          {[
            ["pulse", "Pulso"],
            ["flicker", "Flicker"],
            ["glitch", "Glitch"],
            ["typing", "Digitação"],
          ].map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
        <div className="inline-actions">
          <button
            className="primary"
            disabled={query.busy || !message.trim()}
            onClick={() =>
              void query
                .execute("/api/overlay/live", {
                  revision,
                  patch: { message: { enabled: true, text: message, effect } },
                })
                .catch(() => {})
            }
          >
            Mostrar
          </button>
          <button
            disabled={query.busy}
            onClick={() =>
              void query
                .execute("/api/overlay/live", {
                  revision,
                  patch: { message: { enabled: false } },
                })
                .catch(() => {})
            }
          >
            Ocultar
          </button>
        </div>
      </Card>
      <Card title="Presets" className="section-gap">
        <div className="inline-actions">
          {query.data.presets.map((preset) => (
            <button
              key={preset.id}
              disabled={query.busy}
              onClick={() => {
                if (
                  !window.confirm(
                    `Aplicar ${preset.name}${preset.scene ? ` e trocar para ${preset.scene}` : ""}?`,
                  )
                )
                  return;
                void query
                  .execute(`/api/overlay/presets/${preset.id}/apply`, {
                    revision,
                    switchScene: !!preset.scene,
                  })
                  .catch(() => {});
              }}
            >
              {preset.name}
            </button>
          ))}
        </div>
      </Card>
      <div className="stack section-gap">
        <RuntimeControls />
      </div>
    </div>
  );
}
function DockConnection() {
  const { socket } = useRealtime();
  return (
    <AdminSocketContext.Provider value={socket}>
      <DockContent />
    </AdminSocketContext.Provider>
  );
}
export function ControlDock() {
  const { session } = useSession();
  return session ? (
    <DockConnection />
  ) : (
    <Navigate to="/login?next=dock" replace />
  );
}
