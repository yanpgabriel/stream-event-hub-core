import { useEffect, useState } from "react";
import { Card, ErrorState, Field, Loading } from "../../components/ui";
import { usePresentation } from "./usePresentation";
export function RuntimeControls() {
  const query = usePresentation();
  const [current, setCurrent] = useState(0);
  const [name, setName] = useState("");
  const [label, setLabel] = useState("Novo seguidor");
  useEffect(() => {
    if (query.data) setCurrent(query.data.runtime.goalCurrent);
  }, [query.data?.runtime.goalCurrent]);
  if (!query.data)
    return query.error ? <ErrorState error={query.error} /> : <Loading />;
  const r = query.data.runtime;
  return (
    <>
      <Card
        title="Cronômetro da apresentação"
        subtitle="Independente da transmissão e da captura de métricas."
      >
        <div className="inline-actions">
          {[
            [
              "start",
              r.timerStartedAt ? "Continuar contando" : "Iniciar / retomar",
            ],
            ["pause", "Pausar"],
            ["reset", "Zerar"],
          ].map(([timer, text]) => (
            <button
              key={timer}
              disabled={query.busy}
              onClick={() => {
                if (
                  timer === "reset" &&
                  !window.confirm("Zerar somente o cronômetro visual?")
                )
                  return;
                void query
                  .execute("/api/overlay/runtime", { timer })
                  .catch(() => {});
              }}
            >
              {text}
            </button>
          ))}
        </div>
      </Card>
      <Card
        title="Valor manual da meta"
        subtitle="Em modo automático, este valor é somado ao total da sessão."
      >
        <Field
          label="Valor / ajuste"
          type="number"
          min={0}
          max={1000000}
          step="any"
          value={current}
          onChange={(e) => setCurrent(Number(e.target.value))}
        />
        <button
          disabled={query.busy}
          onClick={() =>
            void query
              .execute("/api/overlay/runtime", { goalCurrent: current })
              .catch(() => {})
          }
        >
          Salvar valor
        </button>
      </Card>
      <Card
        title="Atividade manual"
        subtitle="Afeta somente a exibição, sem gerar eventos ou receita."
      >
        <Field
          label="Nome"
          value={name}
          maxLength={120}
          onChange={(e) => setName(e.target.value)}
        />
        <Field
          label="Tipo / descrição"
          value={label}
          maxLength={120}
          onChange={(e) => setLabel(e.target.value)}
        />
        <button
          disabled={query.busy || !name.trim() || !label.trim()}
          onClick={() =>
            void query
              .execute("/api/overlay/activity", { name, label })
              .then(() => setName(""))
              .catch(() => {})
          }
        >
          Adicionar ao tracker
        </button>
        {r.activity.map((item) => (
          <div className="preset-row-ui" key={item.id}>
            <div>
              {item.name}
              <small>{item.label}</small>
            </div>
            <button
              disabled={query.busy}
              onClick={() =>
                void query
                  .execute(`/api/overlay/activity/${item.id}`, {}, "DELETE")
                  .catch(() => {})
              }
            >
              Remover
            </button>
          </div>
        ))}
      </Card>
    </>
  );
}
