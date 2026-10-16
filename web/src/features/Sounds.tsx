import { useRef, useState } from "react";
import { Pencil, Save, Trash2, Upload, Volume2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Card,
  ConfirmButton,
  Empty,
  ErrorState,
  Field,
  Loading,
  PageTitle,
  Select,
  Toggle,
  useToast,
} from "../components/ui";
import { useConfig } from "../lib/config";
import { useApi } from "../lib/hooks";
import { api } from "../lib/api";
import { alertNames, alertTypes, type Sound } from "../lib/types";
import { speakText } from "../overlays/audio";

export function Sounds() {
  const sounds = useApi<Sound[]>("/api/sounds");
  const config = useConfig();
  const client = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState(
    "Obrigado por fazer parte desta transmissão!",
  );
  const file = useRef<HTMLInputElement>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(
    () => window.speechSynthesis?.getVoices() || [],
  );
  const cfg = config.value;
  const inUse = (url: string) =>
    alertTypes.some(
      (t) =>
        cfg.alertSounds?.[t]?.url === url ||
        config.data?.alertSounds?.[t]?.url === url,
    );
  async function upload(selected?: File) {
    if (!selected) return;
    if (
      selected.size > 5 * 1024 * 1024 ||
      !selected.type.startsWith("audio/")
    ) {
      toast("Selecione um áudio de até 5 MB.", "error");
      return;
    }
    setBusy(true);
    try {
      const form = new FormData();
      form.append("sound", selected);
      await api("/api/sounds/upload", { method: "POST", body: form });
      await client.invalidateQueries({ queryKey: ["/api/sounds"] });
      toast("Áudio enviado.");
      if (file.current) file.current.value = "";
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }
  async function change(sound: Sound, operation: "rename" | "delete") {
    if (inUse(sound.url)) {
      toast(
        "Desvincule este som dos alertas e salve antes de alterar o arquivo.",
        "error",
      );
      return;
    }
    let newName: string | null = null;
    if (operation === "rename") {
      newName = window.prompt(
        "Novo nome, sem extensão:",
        sound.filename.replace(/\.[^.]+$/, ""),
      );
      if (!newName?.trim()) return;
    }
    setBusy(true);
    try {
      await api(`/api/sounds/${encodeURIComponent(sound.filename)}`, {
        method: operation === "delete" ? "DELETE" : "PATCH",
        ...(newName
          ? { body: JSON.stringify({ newName: newName.trim() }) }
          : {}),
      });
      await client.invalidateQueries({ queryKey: ["/api/sounds"] });
      toast(operation === "delete" ? "Áudio excluído." : "Áudio renomeado.");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }
  if (config.isPending) return <Loading />;
  if (config.error) return <ErrorState error={config.error} />;
  return (
    <>
      <PageTitle
        title="O som dos seus melhores momentos."
        description="Monte sua biblioteca de áudios e dê voz aos alertas."
      />
      <div className="settings-columns">
        <div className="stack">
          <Card
            title="Biblioteca de sons"
            subtitle="Arquivos de áudio de até 5 MB."
          >
            <div className="upload-zone">
              <Upload size={24} color="#b69cdb" />
              <p>Escolha um áudio para sua transmissão.</p>
              <input
                ref={file}
                type="file"
                accept="audio/*"
                aria-label="Enviar arquivo de áudio"
                disabled={busy}
                onChange={(e) => void upload(e.target.files?.[0])}
              />
            </div>
            {sounds.error ? (
              <ErrorState error={sounds.error} />
            ) : sounds.data?.length ? (
              sounds.data.map((sound) => (
                <div className="sound-row" key={sound.filename}>
                  <div>
                    <strong>{sound.filename}</strong>
                    <small>
                      {(sound.size / 1024).toFixed(0)} KB
                      {inUse(sound.url) ? " · Vinculado a um alerta" : ""}
                    </small>
                  </div>
                  <audio controls preload="none" src={sound.url} />
                  <div className="inline-actions">
                    <button
                      title="Renomear"
                      aria-label={`Renomear ${sound.filename}`}
                      disabled={busy || inUse(sound.url)}
                      onClick={() => void change(sound, "rename")}
                    >
                      <Pencil size={14} />
                    </button>
                    <ConfirmButton
                      disabled={busy || inUse(sound.url)}
                      question={`Excluir o áudio ${sound.filename}? Esta ação não pode ser desfeita.`}
                      onConfirm={() => void change(sound, "delete")}
                    >
                      <Trash2 size={14} />
                    </ConfirmButton>
                  </div>
                </div>
              ))
            ) : (
              <Empty title="Sua biblioteca está pronta para começar">
                Envie seu primeiro som para associá-lo a um alerta.
              </Empty>
            )}
          </Card>
          <Card title="Som por evento">
            <div className="stack">
              {alertTypes.map((t) => (
                <div className="two-columns" key={t}>
                  <Select
                    label={alertNames[t]}
                    value={cfg.alertSounds?.[t]?.url || ""}
                    onChange={(url) =>
                      config.update("alertSounds", {
                        ...cfg.alertSounds,
                        [t]: {
                          ...cfg.alertSounds?.[t],
                          url,
                          volume: cfg.alertSounds?.[t]?.volume ?? 80,
                        },
                      })
                    }
                  >
                    <option value="">Sem som</option>
                    {sounds.data?.map((s) => (
                      <option key={s.filename} value={s.url}>
                        {s.filename}
                      </option>
                    ))}
                  </Select>
                  <Field
                    label={`Volume · ${cfg.alertSounds?.[t]?.volume ?? 80}%`}
                    type="range"
                    min={0}
                    max={100}
                    value={cfg.alertSounds?.[t]?.volume ?? 80}
                    onChange={(e) =>
                      config.update("alertSounds", {
                        ...cfg.alertSounds,
                        [t]: {
                          url: cfg.alertSounds?.[t]?.url || "",
                          volume: Number(e.target.value),
                        },
                      })
                    }
                  />
                </div>
              ))}
            </div>
            <div className="form-footer">
              <button
                className="primary"
                disabled={config.busy || !config.dirty}
                onClick={() => void config.save()}
              >
                <Save size={15} />
                Salvar sons e voz
              </button>
            </div>
          </Card>
        </div>
        <Card
          title="Texto para voz"
          subtitle="A disponibilidade das vozes depende do navegador."
        >
          {(["sub", "tip", "cheer"] as const).map((t) => (
            <Toggle
              key={t}
              label={alertNames[t]}
              checked={cfg.ttsConfig?.enabled?.[t] ?? false}
              onChange={(value) =>
                config.update("ttsConfig", {
                  ...cfg.ttsConfig,
                  enabled: { ...cfg.ttsConfig?.enabled, [t]: value },
                })
              }
            />
          ))}
          <div className="section-gap">
            <Select
              label="Voz"
              value={cfg.ttsConfig?.voice || "default"}
              onChange={(voice) =>
                config.update("ttsConfig", { ...cfg.ttsConfig, voice })
              }
            >
              <option value="default">Padrão do sistema</option>
              {voices.map((v) => (
                <option key={v.voiceURI} value={v.name}>
                  {v.name} ({v.lang})
                </option>
              ))}
            </Select>
            <button
              onClick={() =>
                setVoices(window.speechSynthesis?.getVoices() || [])
              }
            >
              Atualizar vozes disponíveis
            </button>
            <div className="section-gap">
              <Field
                label={`Velocidade · ${cfg.ttsConfig?.rate ?? 1}×`}
                type="range"
                min={0.5}
                max={2}
                step={0.1}
                value={cfg.ttsConfig?.rate ?? 1}
                onChange={(e) =>
                  config.update("ttsConfig", {
                    ...cfg.ttsConfig,
                    rate: Number(e.target.value),
                  })
                }
              />
              <Field
                label={`Volume · ${Math.round((cfg.ttsConfig?.volume ?? 0.8) * 100)}%`}
                type="range"
                min={0}
                max={100}
                value={Math.round((cfg.ttsConfig?.volume ?? 0.8) * 100)}
                onChange={(e) =>
                  config.update("ttsConfig", {
                    ...cfg.ttsConfig,
                    volume: Number(e.target.value) / 100,
                  })
                }
              />
              <Field
                label="Texto da prévia"
                value={text}
                maxLength={250}
                onChange={(e) => setText(e.target.value)}
              />
              <button
                onClick={() =>
                  void speakText(text, cfg.ttsConfig).catch((e) =>
                    toast(e.message, "error"),
                  )
                }
              >
                <Volume2 size={15} />
                Ouvir prévia
              </button>
            </div>
            <div className="notice">
              <p>
                Confira a voz também no OBS: ele pode oferecer vozes diferentes
                deste navegador. O fallback usa um serviço externo de síntese de
                voz.
              </p>
            </div>
            <button
              className="primary"
              disabled={config.busy || !config.dirty}
              onClick={() => void config.save()}
            >
              <Save size={15} />
              Salvar sons e voz
            </button>
          </div>
        </Card>
      </div>
    </>
  );
}
