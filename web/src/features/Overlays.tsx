import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Copy, ExternalLink, MonitorPlay } from "lucide-react";
import { Card, PageTitle, Select, Toggle, useToast } from "../components/ui";
import { OverlayPreview } from "../overlays/OverlayPreview";
import type { PreviewMode } from "../overlays/preview";
import { PresentationEditor } from "./presentation/PresentationEditor";
import { Presets } from "./presentation/Presets";
import { ObsSettings } from "./presentation/ObsSettings";
import { Migration } from "./presentation/Migration";
import { OverlayAppearanceEditor } from "./presentation/OverlayAppearanceEditor";
function OverlayLinks() {
  const toast = useToast();
  const [preview, setPreview] = useState("widgets");
  const [sound, setSound] = useState(false);
  const [mode, setMode] = useState<PreviewMode>("demo");
  const entries = [
    {
      kind: "cena",
      title: "Composição completa",
      description:
        "Webcam, meta, barra, chat, letreiro, QR e mensagem de tela cheia.",
      size: "Canvas configurável",
    },
    {
      kind: "alertas",
      title: "Alertas da transmissão",
      description: "Seguidores, inscrições, doações, bits e raids.",
      size: "1920 × 1080",
    },
    {
      kind: "chat",
      title: "Chat unificado",
      description: "Mensagens recentes de todas as suas plataformas.",
      size: "450 × 800",
    },
    {
      kind: "destaque",
      title: "Mensagem em destaque",
      description: "A mensagem escolhida no painel de chat.",
      size: "1920 × 400",
    },
    {
      kind: "widgets",
      title: "Últimos eventos",
      description: "Último seguidor e última inscrição.",
      size: "1000 × 180",
    },
    {
      kind: "sorteio",
      title: "Ganhador do sorteio",
      description: "Anúncio dos vencedores sorteados pelo painel.",
      size: "1920 × 1080",
    },
  ];
  return (
    <>
      <div className="settings-columns">
        <div className="stack">
          {entries.map((entry) => {
            const url = `${window.location.origin}/overlays/${entry.kind}`;
            return (
              <Card
                title={entry.title}
                subtitle={entry.description}
                key={entry.kind}
                action={<span className="badge">{entry.size}</span>}
              >
                <div className="overlay-link">
                  <input
                    readOnly
                    value={url}
                    aria-label={`URL de ${entry.title}`}
                  />
                  <button
                    onClick={() =>
                      void navigator.clipboard
                        .writeText(url)
                        .then(() => toast("Link copiado."))
                        .catch(() =>
                          toast(
                            "Não foi possível copiar. Selecione o link manualmente.",
                            "error",
                          ),
                        )
                    }
                    title="Copiar link"
                  >
                    <Copy size={15} />
                  </button>
                  <a
                    className="button"
                    target="_blank"
                    rel="noopener noreferrer"
                    href={url}
                    title="Abrir overlay"
                  >
                    <ExternalLink size={15} />
                  </a>
                  <button onClick={() => setPreview(entry.kind)}>Prévia</button>
                </div>
              </Card>
            );
          })}
        </div>
        <div className="stack">
          <Card
            title="Monitor de prévia"
            subtitle={entries.find((e) => e.kind === preview)?.title}
          >
            <Select
              label="Conteúdo da prévia"
              value={mode}
              onChange={(value) => setMode(value as PreviewMode)}
            >
              <option value="demo">Demonstração com exemplos</option>
              <option value="live">Acompanhar dados reais</option>
            </Select>
            <OverlayPreview kind={preview} mode={mode} sound={sound} />
            {mode === "live" && (
              <Toggle
                label="Áudio na prévia"
                checked={sound}
                onChange={setSound}
                hint="Evite reproduzir som duas vezes com o OBS aberto."
              />
            )}
            <p style={{ fontSize: 11, marginTop: 15 }}>
              {mode === "demo"
                ? "Exemplos visuais para conferir o layout. Não enviam eventos nem alteram a transmissão. Os links para OBS continuam usando dados reais."
                : preview === "alertas"
                  ? "Envie um alerta na aba Testar alertas para ver o sandbox."
                  : "Esta prévia acompanha o estado real da transmissão."}
            </p>
          </Card>
          <Card title="Como adicionar no OBS">
            <div className="notice">
              <MonitorPlay size={20} />
              <p>
                Em Fontes, adicione Navegador, cole a URL e use o tamanho
                recomendado. O fundo já é transparente. Para áudio, habilite o
                controle de áudio pelo OBS.
              </p>
            </div>
            <p style={{ fontSize: 11 }}>
              Mantenha a fonte ativa para receber os eventos. Alertas perdidos
              enquanto a fonte estiver desligada não são reapresentados
              automaticamente.
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}

export function Overlays() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") || "composicao";
  const tabs = [
    ["composicao", "Composição"],
    ["aparencia", "Aparência dos overlays"],
    ["presets", "Presets"],
    ["obs", "OBS"],
    ["migracao", "Migração"],
    ["links", "Links e prévias"],
  ];
  return (
    <>
      <PageTitle
        title="Sua transmissão, do seu jeito."
        description="Edite a composição, organize presets e conecte o OBS."
      />
      <div className="tabs" role="tablist">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? "selected" : ""}
            onClick={() => setParams({ tab: id })}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "composicao" ? (
        <PresentationEditor />
      ) : tab === "aparencia" ? (
        <OverlayAppearanceEditor />
      ) : tab === "presets" ? (
        <Presets />
      ) : tab === "obs" ? (
        <ObsSettings />
      ) : tab === "migracao" ? (
        <Migration />
      ) : (
        <OverlayLinks />
      )}
    </>
  );
}
