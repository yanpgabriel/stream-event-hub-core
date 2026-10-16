import { useContext, useEffect, useRef, useState } from "react";
import { Pause, Play, RefreshCw, Trash2 } from "lucide-react";
import { AdminSocketContext } from "../app/realtime";
import {
  Badge,
  Card,
  ConfirmButton,
  ErrorState,
  PageTitle,
} from "../components/ui";
import { useSession } from "../app/session";
import { dateTime, useAction, useApi } from "../lib/hooks";
import { platforms, platformNames, type Data } from "../lib/types";
export function Diagnostics() {
  const health = useApi("/api/health/connections", 10000);
  const tokens = useApi("/api/health/tokens", 30000);
  const ready = useApi("/api/health/ready", 10000);
  const { session } = useSession();
  const action = useAction();
  const [logs, setLogs] = useState<Data[]>([]);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  const [errorsOnly, setErrorsOnly] = useState(false);
  const logView = useRef<HTMLDivElement>(null);
  const socket = useContext(AdminSocketContext);
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);
  useEffect(() => {
    function log(item: Data) {
      if (!pausedRef.current) setLogs((old) => [...old, item].slice(-500));
    }
    socket?.on("server-log", log);
    return () => {
      socket?.off("server-log", log);
    };
  }, [socket]);
  useEffect(() => {
    if (logView.current)
      logView.current.scrollTop = logView.current.scrollHeight;
  }, [logs]);
  return (
    <>
      <PageTitle
        title="Um olhar por trás da transmissão."
        description="Saúde do servidor, conexões e logs em tempo real."
        actions={
          <ConfirmButton
            disabled={action.isPending}
            question="Reiniciar as conexões de todas as plataformas?"
            onConfirm={() => action.mutate({ path: "/api/listeners/restart" })}
          >
            <RefreshCw size={15} />
            Reiniciar conexões
          </ConfirmButton>
        }
      />
      {health.error && <ErrorState error={health.error} />}
      <div className="metrics-grid">
        <div className="stat-card">
          <div>
            <span>Servidor</span>
          </div>
          <strong>
            {ready.data?.ready
              ? "Pronto"
              : ready.error
                ? "Indisponível"
                : "Verificando"}
          </strong>
          <small>Porta padrão 3232</small>
        </div>
        <div className="stat-card">
          <div>
            <span>Autenticação</span>
          </div>
          <strong style={{ fontSize: 22 }}>
            {session?.trustedLocal ? "Confiança local" : "Sessão protegida"}
          </strong>
          <small>{session?.username}</small>
        </div>
      </div>
      {session?.trustedLocal && (
        <div className="notice warning">
          <p>
            ADMIN_TRUST_LOCAL_NETWORK está ativo. Dispositivos da rede local
            acessam o painel sem login. Para exigir credenciais, configure
            ADMIN_USERNAME, ADMIN_PASSWORD e ADMIN_TRUST_LOCAL_NETWORK=false em
            server/.env.
          </p>
        </div>
      )}
      <div className="platform-grid">
        {platforms.map((p) => (
          <Card
            key={p}
            title={platformNames[p]}
            action={<Badge value={health.data?.[p]?.status} />}
          >
            <dl className="details">
              <dt>Último evento</dt>
              <dd>{dateTime(health.data?.[p]?.lastEventAt)}</dd>
              <dt>Último erro</dt>
              <dd>{health.data?.[p]?.lastError || "Nenhum erro informado"}</dd>
              <dt>Tentativas de reconexão</dt>
              <dd>{health.data?.[p]?.reconnectAttempts || 0}</dd>
              <dt>Tempo conectado</dt>
              <dd>
                {Math.floor((health.data?.[p]?.uptimeMs || 0) / 60000)} min
              </dd>
              <dt>Token de acesso</dt>
              <dd>
                {tokens.data?.[p]?.accessTokenPresent ? "Presente" : "Ausente"}
              </dd>
            </dl>
            <button
              disabled={action.isPending}
              onClick={() =>
                action.mutate({ path: `/api/listeners/restart/${p}` })
              }
            >
              <RefreshCw size={14} />
              Reconectar
            </button>
          </Card>
        ))}
      </div>
      <Card
        title="Console do servidor"
        subtitle="Até 500 registros recebidos enquanto esta tela estiver aberta."
        action={
          <div className="inline-actions">
            <button
              aria-pressed={errorsOnly}
              onClick={() => setErrorsOnly(!errorsOnly)}
            >
              {errorsOnly ? "Mostrar todos" : "Somente erros"}
            </button>
            <button onClick={() => setPaused(!paused)}>
              {paused ? <Play size={13} /> : <Pause size={13} />}{" "}
              {paused ? "Retomar" : "Pausar"}
            </button>
            <button onClick={() => setLogs([])}>
              <Trash2 size={13} />
              Limpar tela
            </button>
          </div>
        }
      >
        <div
          className="log-view"
          ref={logView}
          role="log"
          aria-label="Logs do servidor"
        >
          {logs
            .filter((l) => !errorsOnly || l.level === "error")
            .map((l, i) => (
              <div key={i} className={l.level === "error" ? "log-error" : ""}>
                [{new Date(l.timestamp).toLocaleTimeString("pt-BR")}]{" "}
                {l.level.toUpperCase()} {l.message}
              </div>
            ))}
          {!logs.length && "Aguardando novos registros do servidor…"}
        </div>
      </Card>
      <div className="notice">
        <p>
          Porta, credenciais de administrador, proxy e segredos de ingestão são
          definidos no ambiente do servidor. As credenciais de Twitch, YouTube e
          LivePix são editadas em Integrações.
        </p>
      </div>
    </>
  );
}
