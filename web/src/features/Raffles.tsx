import { useEffect, useState } from "react";
import {
  Pause,
  Play,
  RotateCcw,
  Shuffle,
  Ticket,
  Trash2,
  Trophy,
} from "lucide-react";
import {
  Card,
  ConfirmButton,
  Empty,
  ErrorState,
  Field,
  Loading,
  PageTitle,
  useToast,
} from "../components/ui";
import { useAction, useApi } from "../lib/hooks";
import { platformNames, type RaffleState } from "../lib/types";
export function Raffles() {
  const query = useApi<{ state: RaffleState }>("/api/sorteios/state");
  const action = useAction();
  const toast = useToast();
  const [keyword, setKeyword] = useState("!sorteio");
  const [winner, setWinner] = useState<{
    name: string;
    platform: string;
  } | null>(null);
  useEffect(() => {
    if (query.data) setKeyword(query.data.state.keyword);
  }, [query.data?.state.keyword]);
  if (query.isPending) return <Loading />;
  if (query.error) return <ErrorState error={query.error} />;
  const state = query.data!.state;
  return (
    <>
      <PageTitle
        title="O próximo nome pode surpreender."
        description="Uma palavra no chat. Uma comunidade inteira participando."
        actions={
          <span className={`session-pill ${state.isActive ? "active" : ""}`}>
            <i />
            {state.isActive ? "Inscrições abertas" : "Inscrições fechadas"}
          </span>
        }
      />
      <div className="settings-columns">
        <div className="stack">
          <Card
            title="Participantes"
            subtitle="Inscrições recebidas do chat enquanto o sorteio estiver aberto."
            action={
              <span className="badge">
                {state.participants.length} inscritos
              </span>
            }
          >
            {state.participants.length ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Nome</th>
                      <th>Plataforma</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.participants.map((p) => (
                      <tr key={p.name}>
                        <td className="name">{p.name}</td>
                        <td>{platformNames[p.platform] || p.platform}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty title="Sua comunidade está convidada">
                Abra as inscrições e peça para enviar a palavra-chave no chat.
              </Empty>
            )}
          </Card>
          <Card
            title="Ganhadores"
            subtitle="Nomes já sorteados nesta lista. Um participante pode ser sorteado novamente."
          >
            {state.winners.length ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Ganhador</th>
                      <th>Plataforma</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {state.winners.map((w) => (
                      <tr key={w.name}>
                        <td>
                          <Trophy size={14} color="#dab880" /> {w.name}
                        </td>
                        <td>{platformNames[w.platform] || w.platform}</td>
                        <td>
                          <ConfirmButton
                            disabled={action.isPending}
                            question={`Reapresentar ${w.name} como vencedor no OBS?`}
                            onConfirm={() =>
                              action.mutate({
                                path: "/api/sorteios/replay",
                                body: { name: w.name },
                                message: "Vencedor reapresentado no overlay.",
                              })
                            }
                          >
                            <RotateCcw size={13} />
                            Reapresentar
                          </ConfirmButton>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty title="O primeiro vencedor vem aí" />
            )}
          </Card>
        </div>
        <div className="stack">
          <Card title="Controle do sorteio">
            <Field
              label="Palavra-chave"
              value={keyword}
              maxLength={100}
              onChange={(e) => setKeyword(e.target.value)}
            />
            <p style={{ fontSize: 11 }}>
              As mensagens que contêm esta palavra inscrevem o participante. A
              comparação ignora maiúsculas e acentos.
            </p>
            <div className="inline-actions">
              <button
                disabled={action.isPending || !keyword.trim()}
                className={state.isActive ? "" : "primary"}
                onClick={() =>
                  action.mutate({
                    path: `/api/sorteios/${state.isActive ? "stop" : "start"}`,
                    body: { keyword: keyword.trim() },
                    message: state.isActive
                      ? "Inscrições encerradas."
                      : "Inscrições abertas.",
                  })
                }
              >
                {state.isActive ? <Pause size={15} /> : <Play size={15} />}{" "}
                {state.isActive ? "Fechar inscrições" : "Abrir inscrições"}
              </button>
            </div>
            <div className="raffle-count">{state.participants.length}</div>
            <p>pessoas na torcida</p>
            <button
              className="primary full"
              disabled={action.isPending || !state.participants.length}
              onClick={() => {
                if (
                  !window.confirm(
                    "Sortear e anunciar um vencedor no overlay de produção?",
                  )
                )
                  return;
                action.mutate(
                  { path: "/api/sorteios/draw", message: "Sorteio realizado." },
                  {
                    onSuccess: (data) => {
                      if (data.winner) setWinner(data.winner);
                      else toast("Nenhum participante disponível.", "error");
                    },
                  },
                );
              }}
            >
              <Shuffle size={16} />
              Sortear vencedor
            </button>
            <div className="form-footer">
              <ConfirmButton
                className="danger"
                disabled={action.isPending}
                question="Limpar participantes e ganhadores? Essa lista não poderá ser recuperada."
                onConfirm={() =>
                  action.mutate(
                    { path: "/api/sorteios/clear" },
                    { onSuccess: () => setWinner(null) },
                  )
                }
              >
                <Trash2 size={14} />
                Limpar sorteio
              </ConfirmButton>
            </div>
          </Card>
          {winner && (
            <div className="winner">
              <Trophy size={34} color="#dab880" />
              <p style={{ margin: "10px 0 0" }}>O nome da vez é</p>
              <h3>{winner.name}</h3>
              <small>{platformNames[winner.platform] || winner.platform}</small>
            </div>
          )}
          <div className="notice">
            <Ticket size={19} />
            <p>
              Participantes são identificados pelo nome. A lista fica na memória
              e se perde quando o servidor reinicia. Sorteios e anúncio de
              ganhadores usam o ambiente real.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
