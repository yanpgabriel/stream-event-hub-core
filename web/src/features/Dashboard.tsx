import { Link } from "react-router-dom";
import {
  ArrowDownLeft,
  ArrowRight,
  Bell,
  CircleHelp,
  Clock3,
  Heart,
  MessageSquare,
  Play,
  Radio,
  Square,
  Ticket,
  Users,
  Zap,
} from "lucide-react";
import {
  Badge,
  Card,
  ConfirmButton,
  Empty,
  ErrorState,
  PageTitle,
} from "../components/ui";
import { dateTime, money, useAction, useApi } from "../lib/hooks";
import {
  alertNames,
  platforms,
  platformNames,
  type HistoryEntry,
} from "../lib/types";

export function Dashboard() {
  const health = useApi("/api/health/connections", 10000);
  const audience = useApi("/api/audience", 30000);
  const summary = useApi("/api/session/summary");
  const history = useApi<{ items: HistoryEntry[] }>(
    "/api/alert-history?limit=6",
  );
  const raffle = useApi("/api/sorteios/state");
  const action = useAction();
  const metrics = summary.data?.metrics;
  const active = summary.data?.session?.isActive;
  const viewers = platforms.reduce(
    (sum, p) => sum + Number(audience.data?.[p]?.viewers || 0),
    0,
  );
  const metricsCards = [
    {
      label: "Audiência agora",
      value: viewers.toLocaleString("pt-BR"),
      note: "Twitch e YouTube",
      icon: Users,
      color: "purple",
    },
    {
      label: "Inscrições e membros",
      value: (
        Number(metrics?.twitchSubs?.total || 0) +
        Number(metrics?.youtubeMembers?.total || 0)
      ).toLocaleString("pt-BR"),
      note: "Nesta sessão",
      icon: Heart,
      color: "pink",
    },
    {
      label: "Doações na sessão",
      value: money(
        Number(metrics?.youtubeTips?.totalBrlMinor || 0) +
          Number(metrics?.livepixTips?.totalBrlMinor || 0),
      ),
      note: "Estimativa em BRL",
      icon: ArrowDownLeft,
      color: "green",
    },
    {
      label: "Bits recebidos",
      value: String(metrics?.twitchBits?.total || 0),
      note: "Nesta sessão",
      icon: Zap,
      color: "orange",
    },
  ];
  return (
    <>
      <PageTitle
        title="Sua transmissão, sob controle."
        description="Tudo o que acontece na sua live, em um só lugar."
        actions={
          <>
            <span className={`session-pill ${active ? "active" : ""}`}>
              <i />
              {active ? "Sessão em andamento" : "Captura encerrada"}
            </span>
            <ConfirmButton
              className={active ? "" : "primary"}
              disabled={action.isPending}
              question={
                active
                  ? "Encerrar a captura de métricas desta sessão? A transmissão continuará normalmente."
                  : "Iniciar uma nova sessão de métricas?"
              }
              onConfirm={() =>
                action.mutate({
                  path: `/api/session/${active ? "end" : "start"}`,
                  message: active
                    ? "Captura de métricas encerrada."
                    : "Nova sessão iniciada.",
                })
              }
            >
              {active ? <Square size={14} /> : <Play size={14} />}{" "}
              {active ? "Encerrar sessão" : "Iniciar sessão"}
            </ConfirmButton>
          </>
        }
      />
      {health.error && <ErrorState error={health.error} />}
      <div className="metrics-grid">
        {metricsCards.map(({ label, value, note, icon: Icon, color }) => (
          <article className="stat-card" key={label}>
            <div>
              <span>{label}</span>
              <span className={`stat-icon ${color}`}>
                <Icon size={18} />
              </span>
            </div>
            <strong>{value}</strong>
            <small>{note}</small>
          </article>
        ))}
      </div>
      <div className="section-title">
        <h2>Suas conexões</h2>
        <Link to="/admin/integracoes">
          Gerenciar integrações <ArrowRight size={15} />
        </Link>
      </div>
      <div className="platform-grid">
        {platforms.map((p) => (
          <Card key={p} className={`platform-card ${p}`}>
            <div className="platform-header">
              <span className={`platform-logo ${p}`}>
                {p === "twitch" ? (
                  <MessageSquare size={23} />
                ) : p === "youtube" ? (
                  <Play size={23} />
                ) : (
                  <Zap size={23} />
                )}
              </span>
              <Badge value={health.data?.[p]?.status} />
            </div>
            <h3>{platformNames[p]}</h3>
            <p>
              {p === "livepix"
                ? "Doações e mensagens da comunidade"
                : "Chat, eventos e audiência em tempo real"}
            </p>
            <div className="platform-detail">
              <span>{p === "livepix" ? "Último evento" : "Espectadores"}</span>
              <strong>
                {p === "livepix"
                  ? health.data?.[p]?.lastEventAt
                    ? new Date(health.data[p].lastEventAt).toLocaleTimeString(
                        "pt-BR",
                      )
                    : "Aguardando"
                  : (audience.data?.[p]?.viewers ?? "—")}
              </strong>
            </div>
          </Card>
        ))}
      </div>
      <div className="dashboard-columns">
        <Card
          title="Atividade recente"
          subtitle="Os últimos momentos da sua comunidade"
          action={
            <Link className="text-link" to="/admin/alertas">
              Ver histórico <ArrowRight size={14} />
            </Link>
          }
        >
          {history.data?.items?.length ? (
            <div className="activity-list">
              {history.data.items.map((item) => (
                <div className="activity-item" key={item.id}>
                  <span className={`event-icon ${item.type}`}>
                    <Bell size={17} />
                  </span>
                  <div>
                    <strong>{item.event.name || "Anônimo"}</strong>
                    <p>
                      {alertNames[item.type] || item.type}{" "}
                      <span>
                        · {platformNames[item.platform || ""] || "Evento"}
                      </span>
                    </p>
                  </div>
                  <small>
                    {new Date(item.timestamp).toLocaleTimeString("pt-BR", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </small>
                </div>
              ))}
            </div>
          ) : (
            <Empty title="Aguardando o primeiro momento">
              Seguidores, inscrições e doações aparecerão aqui.
            </Empty>
          )}
        </Card>
        <div className="stack">
          <Card title="Acesso rápido">
            <div className="quick-links">
              {[
                {
                  path: "alertas",
                  icon: Bell,
                  title: "Testar um alerta",
                  text: "Confira antes de entrar ao vivo",
                },
                {
                  path: "chat",
                  icon: MessageSquare,
                  title: "Abrir chat unificado",
                  text: "Converse com toda a comunidade",
                },
                {
                  path: "overlays",
                  icon: Radio,
                  title: "Configurar o OBS",
                  text: "Copie seus links de overlay",
                },
              ].map(({ path, icon: Icon, title, text }) => (
                <Link to={`/admin/${path}`} key={path}>
                  <span className="quick-icon">
                    <Icon size={18} />
                  </span>
                  <div>
                    <strong>{title}</strong>
                    <small>{text}</small>
                  </div>
                  <ArrowRight size={16} />
                </Link>
              ))}
            </div>
          </Card>
          <Card className="raffle-callout">
            <div className="raffle-heading">
              <Ticket size={23} />
              <span className="eyebrow">CONECTE SUA COMUNIDADE</span>
            </div>
            <h3>
              {raffle.data?.state?.isActive
                ? "Sorteio em andamento"
                : "Um motivo a mais para participar."}
            </h3>
            <p>
              {raffle.data?.state?.isActive
                ? `${raffle.data.state.participants.length} participantes aguardando o sorteio.`
                : "Crie um sorteio e transforme o chat em uma grande torcida."}
            </p>
            <Link className="button subtle" to="/admin/sorteios">
              {raffle.data?.state?.isActive
                ? "Acompanhar sorteio"
                : "Criar sorteio"}
              <ArrowRight size={15} />
            </Link>
          </Card>
        </div>
      </div>
      <div className="info-strip">
        <CircleHelp size={17} />
        <span>
          A sessão controla a captura das métricas. Iniciar ou encerrar aqui não
          altera sua transmissão nas plataformas.
        </span>
        <span className="push">
          <Clock3 size={14} /> {dateTime(summary.data?.session?.startedAt)}
        </span>
      </div>
    </>
  );
}
