import { useState } from "react";
import { OverlayPreview } from "../overlays/OverlayPreview";
import {
  Download,
  FlaskConical,
  ListRestart,
  RotateCcw,
  Save,
  Trash2,
} from "lucide-react";
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
} from "../components/ui";
import { useConfig } from "../lib/config";
import { dateTime, useAction, useApi } from "../lib/hooks";
import { queryString } from "../lib/api";
import {
  alertNames,
  alertTypes,
  platformNames,
  type AlertType,
  type HistoryEntry,
} from "../lib/types";

export function Alerts() {
  const config = useConfig();
  const action = useAction();
  const [tab, setTab] = useState("history");
  const [search, setSearch] = useState("");
  const [type, setType] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [cursor, setCursor] = useState(0);
  const [event, setEvent] = useState<AlertType>("follow");
  const [name, setName] = useState("Visitante de teste");
  const [amount, setAmount] = useState("10");
  const [message, setMessage] = useState("Que transmissão incrível!");
  const [tier, setTier] = useState("1000");
  const [target, setTarget] = useState("sandbox");
  const [copies, setCopies] = useState(1);
  const [cooldown, setCooldown] = useState(500);
  const filters = {
    search,
    type,
    from: from ? new Date(from).toISOString() : "",
    to: to ? new Date(to).toISOString() : "",
  };
  const history = useApi<{
    items: HistoryEntry[];
    nextCursor: number | null;
    total: number;
  }>(`/api/alert-history?${queryString({ ...filters, cursor, limit: 25 })}`);
  const queue = useApi("/api/queue/status", tab === "queue" ? 2000 : undefined);
  if (config.isPending) return <Loading />;
  if (config.error) return <ErrorState error={config.error} />;
  const cfg = config.value;
  function test() {
    if (
      target === "production" &&
      !window.confirm(
        "Este teste será transmitido no overlay de produção e registrado no histórico. Continuar?",
      )
    )
      return;
    action.mutate({
      path: "/api/test-alert",
      body: {
        event,
        name,
        amount,
        message,
        tier,
        target,
        duplicateCount: copies,
        cooldownMs: cooldown,
      },
      message:
        target === "sandbox"
          ? "Teste enviado à prévia sandbox."
          : "Alerta enviado à produção.",
    });
  }
  return (
    <>
      <PageTitle
        title="Cada momento merece um alerta."
        description="Controle os eventos, teste sua apresentação e acompanhe o histórico."
      />
      <div className="tabs">
        {[
          ["history", "Histórico"],
          ["settings", "Configurações"],
          ["test", "Testar alertas"],
          ["queue", "Fila do servidor"],
        ].map(([id, label]) => (
          <button
            key={id}
            className={tab === id ? "selected" : ""}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "settings" && (
        <Card
          title="Preferências de alertas"
          subtitle="Os ajustes são aplicados aos próximos eventos."
        >
          <div className="two-columns">
            <div>
              {alertTypes.map((t) => (
                <Toggle
                  key={t}
                  label={alertNames[t]}
                  checked={cfg.alertToggles?.[t] ?? true}
                  onChange={(v) =>
                    config.update("alertToggles", {
                      ...cfg.alertToggles,
                      [t]: v,
                    })
                  }
                />
              ))}
            </div>
            <div>
              <Field
                label="Duração (segundos)"
                type="number"
                min={2}
                max={30}
                value={cfg.alertDuration || 6}
                onChange={(e) =>
                  config.update("alertDuration", Number(e.target.value))
                }
              />
              <Field
                label="Tamanho do texto"
                type="number"
                min={8}
                max={128}
                step={2}
                value={cfg.alertMessageTextSize || 32}
                onChange={(e) =>
                  config.update("alertMessageTextSize", Number(e.target.value))
                }
              />
              <Field
                label="Último seguidor (valor inicial do widget)"
                value={cfg.lastFollower || ""}
                onChange={(e) => config.update("lastFollower", e.target.value)}
              />
              <Field
                label="Última inscrição (valor inicial do widget)"
                value={cfg.lastSub || ""}
                onChange={(e) => config.update("lastSub", e.target.value)}
              />
            </div>
          </div>
          {config.saveError && <ErrorState error={config.saveError} />}
          <div className="form-footer">
            <button
              className="primary"
              disabled={config.busy || !config.dirty}
              onClick={() => void config.save()}
            >
              <Save size={16} />
              Salvar preferências
            </button>
            <a className="button" href="/admin/sons">
              Configurar sons e voz
            </a>
          </div>
        </Card>
      )}
      {tab === "history" && (
        <Card
          title="Histórico de eventos"
          subtitle="Consulte e reapresente os momentos da sua comunidade."
          action={
            <div className="inline-actions">
              {["csv", "json"].map((format) => (
                <a
                  className="button"
                  key={format}
                  href={`/api/alert-history/export?${queryString({ ...filters, format })}`}
                >
                  <Download size={14} />
                  {format.toUpperCase()}
                </a>
              ))}
            </div>
          }
        >
          <div className="filters">
            <Field
              label="Buscar"
              placeholder="Nome ou mensagem"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setCursor(0);
              }}
            />
            <Select
              label="Tipo"
              value={type}
              onChange={(v) => {
                setType(v);
                setCursor(0);
              }}
            >
              <option value="">Todos os eventos</option>
              {alertTypes.map((t) => (
                <option value={t} key={t}>
                  {alertNames[t]}
                </option>
              ))}
            </Select>
            <Field
              label="De"
              type="datetime-local"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                setCursor(0);
              }}
            />
            <Field
              label="Até"
              type="datetime-local"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                setCursor(0);
              }}
            />
          </div>
          {history.error ? (
            <ErrorState error={history.error} />
          ) : history.isPending ? (
            <Loading />
          ) : history.data?.items.length ? (
            <>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Participante</th>
                      <th>Evento</th>
                      <th>Plataforma</th>
                      <th>Data</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {history.data.items.map((item) => (
                      <tr key={item.id}>
                        <td>
                          <span className="name">
                            {item.event.name || "Anônimo"}
                          </span>
                          {item.event.message && (
                            <p
                              style={{
                                margin: "5px 0",
                                fontSize: 10,
                                maxWidth: 300,
                              }}
                            >
                              {item.event.message}
                            </p>
                          )}
                        </td>
                        <td>
                          {alertNames[item.type] || item.type}
                          {item.event.amount && (
                            <small> · {String(item.event.amount)}</small>
                          )}
                        </td>
                        <td>{platformNames[item.platform || ""] || "—"}</td>
                        <td>{dateTime(item.timestamp)}</td>
                        <td>
                          <ConfirmButton
                            disabled={action.isPending}
                            question="Reapresentar este alerta na transmissão? O replay ignora o botão de ativação do tipo de alerta."
                            onConfirm={() =>
                              action.mutate({
                                path: "/api/alert-replay",
                                body: {
                                  listener: item.listener,
                                  event: item.event,
                                },
                                message: "Replay enviado à produção.",
                              })
                            }
                          >
                            <RotateCcw size={13} />
                            Replay
                          </ConfirmButton>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="pagination">
                <span>{history.data.total} eventos</span>
                <div className="inline-actions">
                  <button
                    disabled={cursor === 0}
                    onClick={() => setCursor(Math.max(0, cursor - 25))}
                  >
                    Anterior
                  </button>
                  <button
                    disabled={history.data.nextCursor === null}
                    onClick={() => setCursor(history.data!.nextCursor!)}
                  >
                    Próxima
                  </button>
                </div>
              </div>
            </>
          ) : (
            <Empty title="Sua história começa na próxima live" />
          )}
        </Card>
      )}
      {tab === "test" && (
        <div className="settings-columns">
          <Card
            title="Enviar alerta de teste"
            subtitle="O sandbox permite testar sem transmitir para o público."
          >
            <div className="form-grid">
              <Select
                label="Evento"
                value={event}
                onChange={(v) => setEvent(v as AlertType)}
              >
                {alertTypes.map((t) => (
                  <option key={t} value={t}>
                    {alertNames[t]}
                  </option>
                ))}
              </Select>
              <Select label="Destino" value={target} onChange={setTarget}>
                <option value="sandbox">Sandbox · prévia</option>
                <option value="production">Produção · OBS</option>
              </Select>
              <Field
                label="Nome"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <Field
                label="Valor / quantidade"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              <Field
                label="Mensagem"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
              <Select label="Tier da inscrição" value={tier} onChange={setTier}>
                <option value="1000">Tier 1</option>
                <option value="2000">Tier 2</option>
                <option value="3000">Tier 3</option>
                <option value="Prime">Prime</option>
              </Select>
              <Field
                label="Repetições"
                type="number"
                min={1}
                max={20}
                value={copies}
                onChange={(e) => setCopies(Number(e.target.value))}
              />
              <Field
                label="Intervalo entre envios (ms)"
                type="number"
                min={0}
                max={5000}
                value={cooldown}
                onChange={(e) => setCooldown(Number(e.target.value))}
              />
            </div>
            <div className="form-footer">
              <button
                className="primary"
                disabled={action.isPending}
                onClick={test}
              >
                <FlaskConical size={16} />
                Enviar teste
              </button>
            </div>
          </Card>
          <Card
            title="Prévia sandbox"
            subtitle="Habilite o áudio no navegador para ouvir sons e voz."
          >
            <OverlayPreview
              title="Prévia de alertas sandbox"
              kind="alertas"
              sound
            />
            <p style={{ fontSize: 11, marginTop: 15 }}>
              O alerta aparece após o envio. Eventos de produção não são
              reproduzidos nesta prévia.
            </p>
          </Card>
        </div>
      )}
      {tab === "queue" && (
        <Card
          title="Fila de despacho do servidor"
          subtitle="Não representa a fila visual já recebida pelo OBS."
        >
          <div className="metrics-grid">
            <div className="stat-card">
              <div>Itens pendentes</div>
              <strong>{queue.data?.pending || 0}</strong>
            </div>
            <div className="stat-card">
              <div>Despachando</div>
              <strong>{queue.data?.currentlyPlaying ? "Sim" : "Não"}</strong>
            </div>
          </div>
          <div className="notice">
            <ListRestart size={18} />
            <p>
              O servidor despacha eventos a cada 40 ms. O overlay controla a
              duração de cada alerta. Limpar esta fila não interrompe alertas
              que o OBS já recebeu.
            </p>
          </div>
          <ConfirmButton
            className="danger"
            disabled={action.isPending}
            question="Remover os alertas ainda pendentes no servidor?"
            onConfirm={() => action.mutate({ path: "/api/queue/clear" })}
          >
            <Trash2 size={15} />
            Limpar pendentes
          </ConfirmButton>
        </Card>
      )}
    </>
  );
}
