import { useState } from "react";
import {
  Card,
  ConfirmButton,
  Empty,
  ErrorState,
  Field,
  Loading,
  Select,
} from "../../components/ui";
import { useApi } from "../../lib/hooks";
import { usePresentation } from "./usePresentation";
export function Presets() {
  const query = usePresentation();
  const obs = useApi("/api/obs/status", 10000);
  const [name, setName] = useState("");
  const [scene, setScene] = useState("");
  if (!query.data)
    return query.error ? <ErrorState error={query.error} /> : <Loading />;
  const revision = query.data.revision;
  return (
    <div className="settings-columns">
      <Card
        title="Presets de apresentação"
        subtitle="Carregar prepara um rascunho; aplicar publica o layout."
      >
        {query.data.presets.length ? (
          query.data.presets.map((p) => (
            <div className="preset-row-ui" key={p.id}>
              <div>
                <strong>{p.name}</strong>
                <small>
                  {p.scene ? `Cena vinculada: ${p.scene}` : "Sem troca de cena"}
                </small>
              </div>
              <div className="inline-actions">
                <button
                  disabled={query.busy}
                  onClick={() => {
                    if (window.confirm("Carregar este preset no rascunho?"))
                      void query
                        .execute(`/api/overlay/presets/${p.id}/load`, {
                          revision,
                        })
                        .catch(() => {});
                  }}
                >
                  Carregar
                </button>
                <ConfirmButton
                  disabled={query.busy}
                  question={`Publicar ${p.name}${p.scene ? ` e trocar o OBS para ${p.scene}` : ""}?`}
                  onConfirm={() =>
                    void query
                      .execute(`/api/overlay/presets/${p.id}/apply`, {
                        revision,
                        switchScene: !!p.scene,
                      })
                      .catch(() => {})
                  }
                >
                  Aplicar ao vivo
                </ConfirmButton>
                <button
                  disabled={query.busy}
                  onClick={() => {
                    const renamed = window.prompt("Nome do preset:", p.name);
                    if (renamed)
                      void query
                        .execute(
                          `/api/overlay/presets/${p.id}`,
                          {
                            revision,
                            preset: { name: renamed, scene: p.scene },
                          },
                          "PATCH",
                        )
                        .catch(() => {});
                  }}
                >
                  Renomear
                </button>
                <button
                  disabled={query.busy}
                  onClick={() =>
                    void query
                      .execute("/api/overlay/presets", {
                        revision,
                        preset: {
                          name: `${p.name.slice(0, 85)} (cópia)`,
                          scene: p.scene,
                          copyFrom: p.id,
                        },
                      })
                      .catch(() => {})
                  }
                >
                  Duplicar
                </button>
                <ConfirmButton
                  disabled={query.busy}
                  className="danger"
                  question={`Excluir o preset ${p.name}?`}
                  onConfirm={() =>
                    void query
                      .execute(
                        `/api/overlay/presets/${p.id}`,
                        { revision },
                        "DELETE",
                      )
                      .catch(() => {})
                  }
                >
                  Excluir
                </ConfirmButton>
              </div>
            </div>
          ))
        ) : (
          <Empty title="Salve sua primeira composição" />
        )}
      </Card>
      <Card
        title="Salvar rascunho como preset"
        subtitle="Salve as alterações do editor antes de criar o preset."
      >
        <Field
          label="Nome"
          maxLength={100}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Select label="Cena OBS opcional" value={scene} onChange={setScene}>
          <option value="">Sem troca de cena</option>
          {obs.data?.scenes?.map((s: string) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
        <button
          className="primary"
          disabled={query.busy || !name.trim()}
          onClick={() =>
            void query
              .execute("/api/overlay/presets", {
                revision,
                preset: { name, scene },
              })
              .then(() => setName(""))
              .catch(() => {})
          }
        >
          Salvar preset
        </button>
        <div className="notice">
          <p>
            Presets não incluem senha OBS, cronômetro, valor acumulado da meta,
            participantes ou métricas.
          </p>
        </div>
      </Card>
    </div>
  );
}
