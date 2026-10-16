import { useEffect, useState } from "react";
import { ExternalLink, RefreshCw, Save, Send } from "lucide-react";
import {
  Card,
  ErrorState,
  Field,
  Loading,
  Select,
  Toggle,
} from "../../components/ui";
import { useApi } from "../../lib/hooks";
import {
  goalValue,
  type SceneLayout,
  type SceneSnapshot,
} from "../../../../shared/presentation.mjs";
import { demoChat, demoScene, SceneViewport } from "../../overlays/SceneCanvas";
import {
  alertNames,
  type ChatState,
  type Data,
  type HistoryEntry,
} from "../../lib/types";
import { usePresentation } from "./usePresentation";
import { RuntimeControls } from "./RuntimeControls";

type Group = keyof SceneLayout;
const definitions: {
  group: Group;
  title: string;
  fields: {
    key: string;
    label: string;
    kind?: string;
    choices?: [string, string][];
    min?: number;
    max?: number;
    chatMode?: string;
  }[];
}[] = [
  {
    group: "canvas",
    title: "Canvas da fonte OBS",
    fields: [
      { key: "width", label: "Largura", kind: "number", min: 640, max: 3840 },
      { key: "height", label: "Altura", kind: "number", min: 360, max: 2160 },
    ],
  },
  {
    group: "webcam",
    title: "Webcam e moldura",
    fields: [
      { key: "enabled", label: "Mostrar webcam", kind: "toggle" },
      {
        key: "corner",
        label: "Canto",
        choices: [
          ["top-left", "Superior esquerdo"],
          ["top-right", "Superior direito"],
          ["bottom-left", "Inferior esquerdo"],
          ["bottom-right", "Inferior direito"],
        ],
      },
      { key: "width", label: "Largura", kind: "number" },
      { key: "height", label: "Altura", kind: "number" },
      { key: "sideMargin", label: "Margem lateral", kind: "number" },
      { key: "topMargin", label: "Margem superior", kind: "number" },
      { key: "bottomMargin", label: "Margem inferior", kind: "number" },
      { key: "padding", label: "Espessura da moldura", kind: "number" },
      { key: "showLabel", label: "Mostrar legenda da webcam", kind: "toggle" },
      { key: "label", label: "Legenda" },
    ],
  },
  {
    group: "topbar",
    title: "Barra superior e redes",
    fields: [
      { key: "enabled", label: "Mostrar barra", kind: "toggle" },
      { key: "showGoal", label: "Mostrar meta", kind: "toggle" },
      { key: "showStat", label: "Mostrar placar", kind: "toggle" },
      { key: "socialLabel", label: "Rede / rótulo" },
      { key: "socialValue", label: "Perfil / valor" },
    ],
  },
  {
    group: "goal",
    title: "Meta",
    fields: [
      { key: "label", label: "Nome da meta" },
      { key: "target", label: "Alvo", kind: "number", min: 1 },
      {
        key: "mode",
        label: "Contagem",
        choices: [
          ["manual", "Manual"],
          ["twitchSubs", "Subs Twitch da sessão + ajuste"],
          ["youtubeMembers", "Membros YouTube da sessão + ajuste"],
          ["bits", "Bits da sessão + ajuste"],
          ["donations", "Doações estimadas em BRL da sessão + ajuste"],
        ],
      },
    ],
  },
  {
    group: "stat",
    title: "Placar / destaque de texto",
    fields: [
      { key: "label", label: "Rótulo" },
      {
        key: "source",
        label: "Fonte do valor",
        choices: [
          ["manual", "Texto manual"],
          ["lastFollower", "Último seguidor"],
          ["lastSub", "Última inscrição"],
        ],
      },
      { key: "value", label: "Texto manual / valor inicial" },
    ],
  },
  {
    group: "chat",
    title: "Chat na composição",
    fields: [
      { key: "enabled", label: "Mostrar chat", kind: "toggle" },
      {
        key: "mode",
        label: "Conteúdo do chat",
        choices: [
          ["native", "Chat nativo da composição"],
          ["overlay", "Usar overlay /overlays/chat"],
        ],
      },
      {
        key: "limit",
        label: "Quantidade de mensagens",
        kind: "number",
        min: 1,
        max: 20,
        chatMode: "native",
      },
      {
        key: "textSize",
        label: "Tamanho do texto",
        kind: "number",
        min: 8,
        max: 64,
        chatMode: "native",
      },
      {
        key: "overlayWidth",
        label: "Largura do overlay (px)",
        kind: "number",
        min: 120,
        max: 3840,
        chatMode: "overlay",
      },
      {
        key: "overlayHeight",
        label: "Altura do overlay (px)",
        kind: "number",
        min: 120,
        max: 2160,
        chatMode: "overlay",
      },
    ],
  },
  {
    group: "activity",
    title: "Atividade recente",
    fields: [
      { key: "enabled", label: "Mostrar atividade", kind: "toggle" },
      {
        key: "source",
        label: "Origem",
        choices: [
          ["mixed", "Manual + automática"],
          ["automatic", "Somente automática"],
          ["manual", "Somente manual"],
        ],
      },
      { key: "limit", label: "Quantidade", kind: "number", min: 1, max: 5 },
    ],
  },
  {
    group: "ticker",
    title: "Letreiro",
    fields: [
      { key: "enabled", label: "Mostrar letreiro", kind: "toggle" },
      { key: "text", label: "Texto", kind: "textarea" },
      {
        key: "speed",
        label: "Duração de cada ciclo (segundos)",
        kind: "number",
        min: 5,
        max: 180,
      },
    ],
  },
  {
    group: "theme",
    title: "Tema e efeitos",
    fields: [
      { key: "color", label: "Cor de destaque", kind: "color" },
      { key: "particles", label: "Partículas", kind: "toggle" },
      { key: "flicker", label: "Flicker da moldura/barra", kind: "toggle" },
      { key: "vignette", label: "Vinheta luminosa", kind: "toggle" },
    ],
  },
  {
    group: "qr",
    title: "QR Code local",
    fields: [
      { key: "enabled", label: "Mostrar QR", kind: "toggle" },
      { key: "text", label: "Texto ou URL do QR", kind: "textarea" },
    ],
  },
  {
    group: "message",
    title: "Mensagem de tela cheia",
    fields: [
      { key: "enabled", label: "Mostrar mensagem", kind: "toggle" },
      { key: "text", label: "Texto", kind: "textarea" },
      {
        key: "effect",
        label: "Efeito",
        choices: [
          ["pulse", "Pulso"],
          ["flicker", "Flicker"],
          ["glitch", "Glitch"],
          ["typing", "Digitação"],
        ],
      },
    ],
  },
  {
    group: "connection",
    title: "Ao perder conexão",
    fields: [
      {
        key: "behavior",
        label: "Comportamento do overlay",
        choices: [
          ["keep", "Conservar a última composição"],
          ["warning", "Mostrar Sinal perdido"],
        ],
      },
    ],
  },
];
export function PresentationEditor() {
  const query = usePresentation();
  const live = useApi<SceneSnapshot>("/api/overlay/state");
  const chat = useApi<ChatState>("/api/chat/state?limit=200");
  const metrics = useApi("/api/session/summary");
  const widgets = useApi("/api/widget-data");
  const history = useApi<{ items: HistoryEntry[] }>(
    "/api/alert-history?limit=5",
  );
  const [layout, setLayout] = useState<SceneLayout | null>(null);
  const [revision, setRevision] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [mode, setMode] = useState("draft");
  useEffect(() => {
    if (query.data && !dirty) {
      setLayout(query.data.draft);
      setRevision(query.data.revision);
    }
  }, [query.data, dirty]);
  function change(group: Group, key: string, value: unknown) {
    setLayout((old) =>
      old ? { ...old, [group]: { ...old[group], [key]: value } } : old,
    );
    setDirty(true);
  }
  async function save() {
    if (!layout) return revision;
    const data = await query.execute(
      "/api/overlay/config",
      { patch: layout, revision },
      "PATCH",
      "Rascunho salvo; a composição ao vivo não mudou.",
    );
    setRevision(data.revision);
    setDirty(false);
    return data.revision;
  }
  async function publish() {
    const rev = dirty ? await save() : revision;
    await query.execute(
      "/api/overlay/publish",
      { revision: rev },
      "POST",
      "Composição publicada ao vivo.",
    );
    setMode("live");
  }
  if (query.isPending || !layout)
    return query.error ? <ErrorState error={query.error} /> : <Loading />;
  const sample = demoScene();
  const runtime = { ...query.data!.runtime, ...query.data!.pendingRuntime };
  const draftSnapshot: SceneSnapshot = {
    ...sample,
    ...live.data,
    layout,
    runtime,
    currentGoal: goalValue(layout, runtime, metrics.data?.metrics),
    activity:
      layout.activity.source === "manual"
        ? runtime.activity
        : [
            ...(layout.activity.source === "mixed" ? runtime.activity : []),
            ...(history.data?.items || [])
              .filter(
                (item) =>
                  !item.replay && (item as unknown as Data).origin !== "test",
              )
              .map((item) => ({
                id: String(item.id),
                name: String(item.event.name || "Anônimo"),
                label: alertNames[item.type] || "Evento",
                source: "automatic",
              })),
          ],
    statValue:
      layout.stat.source === "manual"
        ? layout.stat.value
        : widgets.data?.[layout.stat.source] || layout.stat.value,
  };
  const snapshot =
    mode === "live"
      ? live.data || draftSnapshot
      : mode === "demo"
        ? { ...sample, layout }
        : draftSnapshot;
  return (
    <>
      <div className="settings-columns">
        <div className="stack scene-editor-fields">
          <Card
            title="Editor de composição"
            subtitle="As alterações só entram na transmissão após Aplicar ao vivo."
          >
            <div className="scene-editor-toolbar">
              <button
                className="primary"
                disabled={query.busy}
                onClick={() => void publish().catch(() => {})}
              >
                <Send size={15} />
                Aplicar ao vivo
              </button>
              <button
                disabled={query.busy || !dirty}
                onClick={() => void save().catch(() => {})}
              >
                <Save size={15} />
                Salvar rascunho
              </button>
              <button
                disabled={query.busy}
                onClick={() => {
                  if (
                    dirty &&
                    !window.confirm("Descartar alterações não salvas?")
                  )
                    return;
                  setDirty(false);
                  void query.refetch();
                }}
              >
                <RefreshCw size={14} />
                Recarregar
              </button>
              <small>
                {dirty ? "Alterações pendentes" : `Revisão ${revision}`}
              </small>
            </div>
            <div className="notice">
              <p>
                Contagens automáticas usam a sessão de métricas e um ajuste
                manual. Doações em BRL são estimativas. O cronômetro visual não
                inicia a transmissão.
              </p>
            </div>
          </Card>
          {definitions.map((section) => (
            <Card key={section.group} title={section.title}>
              <div className="form-grid">
                {section.fields.map((field) => {
                  if (field.chatMode && field.chatMode !== layout.chat.mode)
                    return null;
                  const value = (layout[section.group] as unknown as Data)[
                    field.key
                  ];
                  const key = `${section.group}.${field.key}`;
                  return field.kind === "toggle" ? (
                    <Toggle
                      key={key}
                      label={field.label}
                      checked={value}
                      onChange={(v) => change(section.group, field.key, v)}
                    />
                  ) : field.choices ? (
                    <Select
                      key={key}
                      label={field.label}
                      value={String(value)}
                      onChange={(v) => change(section.group, field.key, v)}
                    >
                      {field.choices.map(([v, label]) => (
                        <option key={v} value={v}>
                          {label}
                        </option>
                      ))}
                    </Select>
                  ) : field.kind === "textarea" ? (
                    <label key={key} className="field">
                      <span>{field.label}</span>
                      <textarea
                        value={String(value)}
                        maxLength={2000}
                        rows={3}
                        onChange={(e) =>
                          change(section.group, field.key, e.target.value)
                        }
                      />
                    </label>
                  ) : (
                    <Field
                      key={key}
                      label={field.label}
                      type={field.kind || "text"}
                      value={value}
                      min={field.min ?? 0}
                      max={field.max}
                      disabled={
                        section.group === "webcam" &&
                        field.key === "label" &&
                        !layout.webcam.showLabel
                      }
                      onChange={(e) =>
                        change(
                          section.group,
                          field.key,
                          field.kind === "number"
                            ? Number(e.target.value)
                            : e.target.value,
                        )
                      }
                    />
                  );
                })}
              </div>
              {section.group === "chat" && layout.chat.mode === "overlay" && (
                <p>
                  Usa o mesmo{" "}
                  <a
                    href="/overlays/chat"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    overlay de chat
                  </a>{" "}
                  deste servidor, com as cores e fontes publicadas em Aparência
                  dos overlays → Chat. A área é limitada ao espaço disponível no
                  canvas. O modo com exemplos não exibe mensagens reais; as
                  outras visualizações acompanham o chat ao vivo.
                </p>
              )}
            </Card>
          ))}
        </div>
        <div className="stack scene-monitor-column">
          <Card
            title="Monitor da composição"
            subtitle="A prévia escala o canvas inteiro, preservando posições e proporções."
          >
            <Select label="Visualização" value={mode} onChange={setMode}>
              <option value="draft">Rascunho com dados atuais</option>
              <option value="demo">Rascunho com exemplos</option>
              <option value="live">Composição publicada</option>
            </Select>
            <div className="scene-editor-preview">
              <SceneViewport
                snapshot={snapshot}
                messages={mode === "demo" ? demoChat : chat.data?.recent || []}
                demo={mode === "demo"}
              />
            </div>
            <div className="scene-editor-toolbar">
              <a
                className="button"
                target="_blank"
                rel="noopener noreferrer"
                href="/overlays/cena"
              >
                <ExternalLink size={14} />
                Abrir fonte OBS
              </a>
              <a
                className="button"
                target="_blank"
                rel="noopener noreferrer"
                href="/admin/dock"
              >
                Abrir controle compacto
              </a>
            </div>
            <small>
              {layout.canvas.width} × {layout.canvas.height} · A área da webcam
              é transparente; a câmera real fica no OBS.
            </small>
          </Card>
          <RuntimeControls />
        </div>
      </div>
    </>
  );
}
