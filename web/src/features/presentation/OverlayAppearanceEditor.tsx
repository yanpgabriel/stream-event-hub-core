import { useEffect, useState } from "react";
import { Save, Send } from "lucide-react";
import {
  Card,
  ErrorState,
  Field,
  Loading,
  Select,
  Toggle,
} from "../../components/ui";
import { OverlayPreview } from "../../overlays/OverlayPreview";
import {
  DEFAULT_APPEARANCES,
  OVERLAY_KINDS,
  OVERLAY_POSITIONS,
  type OverlayAppearance,
  type OverlayKind,
} from "../../../../shared/overlayAppearance.mjs";
import { usePresentation } from "./usePresentation";

const labels: Record<OverlayKind, string> = {
  alertas: "Alertas",
  chat: "Chat",
  destaque: "Mensagem em destaque",
  widgets: "Últimos eventos",
  sorteio: "Ganhador do sorteio",
};
const positionLabels: Record<string, string> = {
  "top-left": "Superior esquerdo",
  "top-center": "Superior central",
  "top-right": "Superior direito",
  "center-left": "Centro esquerdo",
  "center-center": "Centro",
  "center-right": "Centro direito",
  "bottom-left": "Inferior esquerdo",
  "bottom-center": "Inferior central",
  "bottom-right": "Inferior direito",
};
const dimensions: {
  key: keyof OverlayAppearance;
  label: string;
  max: number;
  min?: number;
  hint?: string;
}[] = [
  { key: "titleSize", label: "Tamanho do título (px)", min: 8, max: 150 },
  {
    key: "textSize",
    label: "Tamanho do texto (px)",
    max: 150,
    hint: "0 preserva o tamanho configurado no chat/alerta; personalizado: 8–150.",
  },
  { key: "borderWidth", label: "Espessura da borda (px)", max: 20 },
  { key: "borderRadius", label: "Arredondamento (px)", max: 150 },
  { key: "padding", label: "Espaçamento interno (px)", max: 150 },
  { key: "margin", label: "Margem da tela (px)", max: 300 },
  {
    key: "maxWidth",
    label: "Largura máxima (px)",
    max: 3840,
    hint: "0 usa o espaço disponível na fonte do OBS.",
  },
  {
    key: "maxHeight",
    label: "Altura máxima (px)",
    max: 2160,
    hint: "0 usa o espaço disponível. O excedente é recortado; no chat, as mensagens mais recentes têm prioridade.",
  },
];

export function OverlayAppearanceEditor() {
  const query = usePresentation();
  const [kind, setKind] = useState<OverlayKind>("alertas");
  const [appearance, setAppearance] = useState<OverlayAppearance>(
    DEFAULT_APPEARANCES.alertas,
  );
  const [revision, setRevision] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [mode, setMode] = useState("draft");
  useEffect(() => {
    if (query.data && !dirty) {
      setAppearance(query.data.appearances.draft[kind]);
      setRevision(query.data.revision);
    }
  }, [query.data, dirty, kind]);
  function change(key: keyof OverlayAppearance, value: unknown) {
    setAppearance((old) => ({ ...old, [key]: value }));
    setDirty(true);
    setMode("draft");
  }
  async function save() {
    const data = await query.execute(
      `/api/overlay/appearance/${kind}`,
      { patch: appearance, revision },
      "PATCH",
      "Aparência salva no rascunho; o overlay ao vivo não mudou.",
    );
    setRevision(data.revision);
    setDirty(false);
    return data.revision;
  }
  async function publish() {
    const rev = dirty ? await save() : revision;
    await query.execute(
      `/api/overlay/appearance/${kind}/publish`,
      { revision: rev },
      "POST",
      `${labels[kind]} atualizado ao vivo.`,
    );
    setMode("published");
  }
  if (query.isPending || !query.data)
    return query.error ? <ErrorState error={query.error} /> : <Loading />;
  const sceneColor = query.data.published.theme.color;
  return (
    <div className="settings-columns">
      <div className="stack">
        <Card
          title="Aparência dos overlays individuais"
          subtitle="Cada overlay tem sua própria aparência. Publicar aqui não altera a composição nem seus presets."
        >
          <Select
            label="Overlay para personalizar"
            value={kind}
            onChange={(value) => {
              if (
                dirty &&
                !window.confirm(
                  "Descartar alterações não salvas deste overlay?",
                )
              )
                return;
              setDirty(false);
              setKind(value as OverlayKind);
              setMode("draft");
            }}
          >
            {OVERLAY_KINDS.map((value) => (
              <option key={value} value={value}>
                {labels[value]}
              </option>
            ))}
          </Select>
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
                  !window.confirm(
                    "Restaurar a aparência padrão no rascunho deste overlay?",
                  )
                )
                  return;
                setAppearance({ ...DEFAULT_APPEARANCES[kind] });
                setDirty(true);
                setMode("draft");
              }}
            >
              Restaurar padrão
            </button>
          </div>
          <small>
            {dirty ? "Alterações locais não salvas" : `Revisão ${revision}`} · A
            URL do OBS continua a mesma.
          </small>
          {dirty && revision !== query.data.revision && (
            <p className="notice">
              Houve uma alteração em outra aba. Copie seus ajustes e recarregue
              antes de salvar.
            </p>
          )}
          <button
            disabled={query.busy}
            onClick={() => {
              if (
                dirty &&
                !window.confirm(
                  "Descartar alterações locais e recarregar o rascunho?",
                )
              )
                return;
              setDirty(false);
              void query.refetch();
            }}
          >
            Recarregar rascunho
          </button>
        </Card>
        <Card title="Cores e fundo">
          <Toggle
            label="Usar a cor da cena principal"
            checked={appearance.useSceneColor}
            onChange={(value) => change("useSceneColor", value)}
            hint="Acompanha a cor publicada da composição, inclusive quando ela mudar."
          />
          <div className="form-grid">
            <Field
              label="Cor de destaque e borda"
              type="color"
              value={appearance.accentColor}
              disabled={appearance.useSceneColor}
              onChange={(e) => change("accentColor", e.target.value)}
            />
            <Field
              label="Cor do texto"
              type="color"
              value={appearance.textColor}
              onChange={(e) => change("textColor", e.target.value)}
            />
            <Field
              label="Cor do fundo"
              type="color"
              value={appearance.backgroundColor}
              onChange={(e) => change("backgroundColor", e.target.value)}
            />
            <Field
              label="Opacidade do fundo (%)"
              type="number"
              min={0}
              max={100}
              value={appearance.backgroundOpacity}
              onChange={(e) =>
                change("backgroundOpacity", Number(e.target.value))
              }
              hint="0 deixa o fundo transparente, sem apagar o texto."
            />
          </div>
          <Toggle
            label="Brilho externo"
            checked={appearance.glow}
            onChange={(value) => change("glow", value)}
          />
        </Card>
        <Card title="Tipografia, moldura e posição">
          <div className="form-grid">
            <Select
              label="Fonte"
              value={appearance.font}
              onChange={(value) => change("font", value)}
            >
              <option value="system">Sistema</option>
              <option value="sans">Arial / sem serifa</option>
              <option value="serif">Georgia / com serifa</option>
              <option value="mono">Consolas / monoespaçada</option>
            </Select>
            <Select
              label="Alinhamento do texto"
              value={appearance.textAlign}
              onChange={(value) => change("textAlign", value)}
            >
              <option value="left">Esquerda</option>
              <option value="center">Centro</option>
              <option value="right">Direita</option>
            </Select>
            <Select
              label="Posição na fonte OBS"
              value={appearance.position}
              onChange={(value) => change("position", value)}
            >
              {OVERLAY_POSITIONS.map((value) => (
                <option key={value} value={value}>
                  {positionLabels[value]}
                </option>
              ))}
            </Select>
            <Select
              label="Animação de entrada"
              value={appearance.animation}
              onChange={(value) => change("animation", value)}
            >
              <option value="none">Nenhuma</option>
              <option value="fade">Aparecer</option>
              <option value="slide">Deslizar</option>
            </Select>
            {dimensions.map((field) => (
              <Field
                key={field.key}
                label={field.label}
                type="number"
                min={field.min || 0}
                max={field.max}
                value={appearance[field.key] as number}
                hint={field.hint}
                onChange={(e) => change(field.key, Number(e.target.value))}
              />
            ))}
          </div>
          <small>
            No chat, o tamanho do título controla os nomes. Em Últimos eventos,
            controla os valores.
          </small>
        </Card>
      </div>
      <div className="stack scene-monitor-column">
        <Card
          title={`Monitor: ${labels[kind]}`}
          subtitle="Exemplos isolados: editar esta prévia não envia eventos nem muda a transmissão."
        >
          <Select label="Aparência da prévia" value={mode} onChange={setMode}>
            <option value="draft">Rascunho em edição</option>
            <option value="published">Aparência publicada</option>
          </Select>
          <OverlayPreview
            kind={kind}
            mode="demo"
            appearance={
              mode === "draft"
                ? appearance
                : query.data.appearances.published[kind]
            }
            sceneColor={sceneColor}
          />
          <p>
            O monitor é compacto; tamanhos e margens são adaptados à prévia.
            Confira a fonte no tamanho final no OBS.
          </p>
          <a
            className="button"
            target="_blank"
            rel="noopener noreferrer"
            href={`/overlays/${kind}`}
          >
            Abrir fonte OBS
          </a>
        </Card>
      </div>
    </div>
  );
}
