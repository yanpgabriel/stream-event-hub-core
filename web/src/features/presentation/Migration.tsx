import { useState } from "react";
import {
  Card,
  ConfirmButton,
  ErrorState,
  Field,
  Select,
  Toggle,
} from "../../components/ui";
import { useApi } from "../../lib/hooks";
import type { Data } from "../../lib/types";
import { SceneViewport, demoChat, demoScene } from "../../overlays/SceneCanvas";
import { usePresentation } from "./usePresentation";
export function Migration() {
  const actions = usePresentation();
  const backups = useApi<string[]>("/api/overlay/backups");
  const [files, setFiles] = useState<Data>({});
  const [report, setReport] = useState<Data | null>(null);
  const [includeObs, setIncludeObs] = useState(false);
  const [restoreObs, setRestoreObs] = useState(false);
  const [backup, setBackup] = useState("");
  const [error, setError] = useState<Error | null>(null);
  async function select(kind: string, file?: File) {
    if (!file) return;
    setFiles((old) => {
      const next = { ...old };
      delete next[kind];
      return next;
    });
    setError(null);
    setReport(null);
    try {
      if (file.size > 150000)
        throw new Error("Arquivo muito grande. Limite de 150 KB por arquivo.");
      const text = await file.text();
      setFiles((old) => ({
        ...old,
        [kind]: kind === "html" ? text : JSON.parse(text),
      }));
    } catch (e) {
      setError(e as Error);
    }
  }
  return (
    <div className="settings-columns">
      <div className="stack">
        <Card
          title="Importar do projeto antigo"
          subtitle="Selecione arquivos de D:\stream\overlays. O diretório de origem não é alterado."
        >
          <div className="migration-files">
            {[
              ["config", "config.json (obrigatório)"],
              ["presets", "presets.json (opcional)"],
              ["obs", "obs-config.json (opcional)"],
              ["html", "overlay.html (rede social, opcional)"],
            ].map(([key, label]) => (
              <Field
                key={key}
                label={label}
                type="file"
                accept={key === "html" ? ".html" : ".json"}
                onChange={(e) => void select(key, e.target.files?.[0])}
              />
            ))}
          </div>
          {error && <ErrorState error={error} />}
          <button
            className="primary"
            disabled={actions.busy || !files.config}
            onClick={() =>
              void actions
                .execute(
                  "/api/migration/overlays/preview",
                  files,
                  "POST",
                  "Arquivos validados, sem alterar o projeto.",
                )
                .then(setReport)
                .catch(() => {})
            }
          >
            Validar e visualizar importação
          </button>
          <div className="notice">
            <p>
              Não selecione secret.token. Senhas não aparecem no relatório. O
              cronômetro antigo e a transmissão não serão iniciados
              automaticamente.
            </p>
          </div>
        </Card>
        {report && (
          <Card title="Revisão antes de importar">
            <p>
              {report.presets.length} presets · {report.activityCount}{" "}
              atividades manuais · Meta inicial: {report.goalCurrent}
            </p>
            {report.warnings.map((warning: string) => (
              <div className="notice" key={warning}>
                <p>{warning}</p>
              </div>
            ))}
            {report.obs && (
              <>
                <Toggle
                  label="Importar também a configuração OBS"
                  checked={includeObs}
                  onChange={setIncludeObs}
                  hint={`Cena: ${report.obs.scene || "não mapeada"} · Fonte: ${report.obs.source || "não mapeada"} · Senha: ${report.obs.passwordConfigured ? "presente" : "ausente"}`}
                />
                <p style={{ fontSize: 11 }}>
                  A conexão e o gerenciamento da webcam serão importados
                  desativados.
                </p>
              </>
            )}
            <ConfirmButton
              className="primary"
              disabled={actions.busy || !actions.data}
              question="Criar um backup e importar o rascunho, a meta manual e as atividades selecionadas? A composição publicada só muda ao aplicar ao vivo."
              onConfirm={() =>
                void actions
                  .execute("/api/migration/overlays/apply", {
                    token: report.token,
                    revision: actions.data!.revision,
                    includeObs,
                  })
                  .then((result) => {
                    setReport(null);
                    setBackup(result.backup);
                    void backups.refetch();
                  })
                  .catch(() => {})
              }
            >
              Criar backup e importar
            </ConfirmButton>
          </Card>
        )}
        <Card
          title="Reverter importação / apresentação"
          subtitle="A restauração republica a composição do backup. O estado anterior também é salvo."
        >
          <Select label="Backup" value={backup} onChange={setBackup}>
            <option value="">Escolha um backup</option>
            {backups.data?.map((id) => (
              <option key={id} value={id}>
                {new Date(Number(id.split("-")[0])).toLocaleString("pt-BR")} ·{" "}
                {id.slice(-12)}
              </option>
            ))}
          </Select>
          <Toggle
            label="Restaurar também a configuração OBS, se disponível"
            checked={restoreObs}
            onChange={setRestoreObs}
            hint="A conexão e o gerenciamento continuarão desativados até revisão."
          />
          <ConfirmButton
            className="danger"
            disabled={actions.busy || !backup || !actions.data}
            question="Restaurar a apresentação deste backup? A composição ao vivo será alterada."
            onConfirm={() =>
              void actions
                .execute("/api/migration/overlays/restore", {
                  backup,
                  revision: actions.data!.revision,
                  restoreObs,
                })
                .then(() => backups.refetch())
                .catch(() => {})
            }
          >
            Restaurar backup
          </ConfirmButton>
        </Card>
      </div>
      <Card
        title="Prévia da importação"
        subtitle="Exemplos locais. Nenhuma ação é enviada ao OBS."
      >
        {report ? (
          <div className="scene-editor-preview">
            <SceneViewport
              snapshot={{
                ...demoScene(),
                layout: report.layout,
                currentGoal: report.goalCurrent,
              }}
              messages={demoChat}
            />
          </div>
        ) : (
          <p>Valide os arquivos para ver a composição convertida.</p>
        )}
        <div className="notice warning">
          <p>
            Depois da revisão, ensaie numa cena duplicada. Troque a fonte antiga
            pela URL /overlays/cena e confirme que nenhum dock ou fonte ainda
            depende da porta 8080.
          </p>
        </div>
      </Card>
    </div>
  );
}
