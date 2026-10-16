import { useState } from "react";
import {
  Card,
  Empty,
  ErrorState,
  Field,
  Loading,
  PageTitle,
  Select,
} from "../components/ui";
import { dateTime, money, useApi } from "../lib/hooks";
import { queryString } from "../lib/api";
import { platforms, platformNames, type Data } from "../lib/types";
export function Analytics() {
  const [period, setPeriod] = useState("last_session");
  const [platform, setPlatform] = useState("all");
  const [bucket, setBucket] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const summary = useApi("/api/session/summary");
  const query = useApi(
    `/api/analytics/overview?${queryString({ period, platform, bucket, from, to, tzOffsetMin: -new Date().getTimezoneOffset() })}`,
  );
  const data = query.data;
  const selected = data?.selected;
  const series: Data[] = data?.charts?.revenueSeries || [];
  const max = Math.max(1, ...series.map((s) => s.revenueBrlMinor));
  return (
    <>
      <PageTitle
        title="Entenda o que faz sua live crescer."
        description="Métricas da sua comunidade, sessão após sessão."
      />
      <Card>
        <div className="filters">
          <Select label="Período" value={period} onChange={setPeriod}>
            {[
              ["last_session", "Última sessão"],
              ["day", "Hoje"],
              ["week", "Esta semana"],
              ["month", "Este mês"],
              ["year", "Este ano"],
              ["lifetime", "Todo o histórico"],
              ["custom", "Personalizado"],
            ].map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
          <Select label="Plataforma" value={platform} onChange={setPlatform}>
            <option value="all">Todas</option>
            {platforms.map((p) => (
              <option key={p} value={p}>
                {platformNames[p]}
              </option>
            ))}
          </Select>
          <Select label="Agrupar por" value={bucket} onChange={setBucket}>
            <option value="">Automático</option>
            <option value="hour">Hora</option>
            <option value="day">Dia</option>
            <option value="week">Semana</option>
            <option value="month">Mês</option>
          </Select>
          {period === "custom" && (
            <>
              <Field
                label="De"
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
              <Field
                label="Até"
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </>
          )}
        </div>
        <small>
          Fuso: {Intl.DateTimeFormat().resolvedOptions().timeZone}. Valores em
          BRL convertidos com as taxas fixas do servidor são estimativas.
        </small>
      </Card>
      {query.error ? (
        <ErrorState error={query.error} />
      ) : query.isPending ? (
        <Loading />
      ) : (
        <>
          <div className="metrics-grid section-gap">
            {[
              ["Receita estimada", selected?.revenueDisplay || money(0)],
              ["Subs Twitch", String(selected?.twitchSubs || 0)],
              [
                "Membros YouTube",
                String(
                  (selected?.youtubeMembers || 0) +
                    (selected?.youtubeMembersGifted || 0),
                ),
              ],
              ["Bits", String(selected?.twitchBits || 0)],
            ].map(([label, value]) => (
              <div className="stat-card" key={label}>
                <div>
                  <span>{label}</span>
                </div>
                <strong>{value}</strong>
                <small>No período selecionado</small>
              </div>
            ))}
          </div>
          <div className="two-columns">
            <Card
              title="Doações ao longo do tempo"
              subtitle={`${dateTime(data?.filter.startAt)} → ${dateTime(data?.filter.endAt)}`}
            >
              {selected?.eventCount ? (
                <>
                  <div
                    className="chart-bars"
                    role="img"
                    aria-label="Gráfico de doações; dados disponíveis na tabela abaixo"
                  >
                    {series.map((s) => (
                      <div
                        className="chart-bar"
                        key={s.key}
                        title={`${s.label}: ${s.revenueDisplay}`}
                        style={{
                          height: `${Math.max(2, (s.revenueBrlMinor / max) * 100)}%`,
                        }}
                      />
                    ))}
                  </div>
                  <details>
                    <summary>Ver dados da série</summary>
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Intervalo</th>
                            <th>Doações</th>
                            <th>Subs</th>
                            <th>Membros</th>
                            <th>Bits</th>
                          </tr>
                        </thead>
                        <tbody>
                          {series.map((s, index) => {
                            const m = data?.charts?.monetizationSeries?.[index];
                            return (
                              <tr key={s.key}>
                                <td>{s.label}</td>
                                <td>{s.revenueDisplay}</td>
                                <td>{m?.twitchSubs || 0}</td>
                                <td>{m?.youtubeMembers || 0}</td>
                                <td>{m?.twitchBits || 0}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </details>
                </>
              ) : (
                <Empty title="As métricas começam com sua comunidade">
                  Eventos capturados aparecerão neste período.
                </Empty>
              )}
            </Card>
            <Card
              title="Doações por plataforma"
              subtitle="Participação na receita estimada em BRL."
            >
              {selected?.platformRevenue?.map((row: Data) => (
                <div className="progress-row" key={row.platform}>
                  <div>
                    <span>{platformNames[row.platform]}</span>
                    <span>
                      {row.revenueDisplay} · {row.percentage}%
                    </span>
                  </div>
                  <div className="progress-track">
                    <div style={{ width: `${row.percentage}%` }} />
                  </div>
                </div>
              ))}
              <div className="notice">
                <p>
                  Subs, membros e bits são contagens. Não representam valores
                  líquidos recebidos das plataformas.
                </p>
              </div>
            </Card>
            <Card
              title="Quem apoia sua transmissão"
              subtitle="Até 15 apoiadores por valor de doações."
            >
              {selected?.topSupporters?.length ? (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Nome</th>
                        <th>Plataforma</th>
                        <th>Doações</th>
                        <th>Total estimado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selected.topSupporters.map((s: Data) => (
                        <tr key={`${s.platform}-${s.name}`}>
                          <td>{s.name}</td>
                          <td>{platformNames[s.platform]}</td>
                          <td>{s.donationCount}</td>
                          <td>{s.revenueDisplay}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty title="Os apoiadores aparecerão aqui" />
              )}
            </Card>
            <Card
              title="Valores por moeda"
              subtitle="Valores originais das doações, antes da conversão."
            >
              {selected?.byCurrency?.length ? (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Moeda</th>
                        <th>Eventos</th>
                        <th>Total original</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selected.byCurrency.map((r: Data) => (
                        <tr key={r.currency}>
                          <td>{r.currency}</td>
                          <td>{r.count}</td>
                          <td>{r.sourceDisplay}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty title="Nenhuma doação neste período" />
              )}
              {selected?.unconverted?.length > 0 && (
                <div className="notice warning">
                  <p>
                    Sem taxa de conversão:{" "}
                    {selected.unconverted
                      .map((r: Data) => r.sourceDisplay)
                      .join(", ")}
                    . Esses valores não estão incluídos no total em BRL.
                  </p>
                </div>
              )}
            </Card>
          </div>
          <Card
            className="section-gap"
            title="Sessões registradas"
            subtitle="Até 24 sessões com eventos da plataforma selecionada; lista independente do filtro de período."
          >
            {selected?.sessions?.length ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Início</th>
                      <th>Fim / estado</th>
                      <th>Eventos</th>
                      <th>Doações estimadas</th>
                      <th>Subs / membros</th>
                      <th>Bits</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selected.sessions.map((s: Data) => (
                      <tr key={s.id}>
                        <td>{dateTime(s.startedAt)}</td>
                        <td>
                          {s.isActive ? "Capturando" : dateTime(s.endedAt)}
                        </td>
                        <td>{s.eventCount}</td>
                        <td>{s.revenueDisplay}</td>
                        <td>
                          {s.twitchSubs} /{" "}
                          {(s.youtubeMembers || 0) +
                            (s.youtubeMembersGifted || 0)}
                        </td>
                        <td>{s.twitchBits}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty title="Nenhuma sessão com eventos ainda" />
            )}
          </Card>
          <Card
            title="Detalhamento da sessão atual"
            subtitle={
              summary.data?.session?.isActive
                ? "Captura em andamento"
                : "Captura encerrada"
            }
            className="section-gap"
          >
            <div className="two-columns">
              <div>
                <h3>Twitch</h3>
                <p>
                  {summary.data?.metrics?.twitchSubs?.breakdownLabel ||
                    "Sem inscrições."}
                </p>
                <p>
                  Presentes: {summary.data?.metrics?.twitchSubs?.gifted || 0}
                </p>
              </div>
              <div>
                <h3>YouTube</h3>
                <p>
                  {summary.data?.metrics?.youtubeMembers?.breakdownLabel ||
                    "Sem membros."}
                </p>
              </div>
            </div>
            <small>
              Doações YouTube:{" "}
              {summary.data?.metrics?.youtubeTips?.totalBrlDisplay || money(0)}{" "}
              · LivePix:{" "}
              {summary.data?.metrics?.livepixTips?.totalBrlDisplay || money(0)}{" "}
              · Eventos descartados pelo limite:{" "}
              {summary.data?.session?.droppedEvents || 0}
            </small>
          </Card>
        </>
      )}
    </>
  );
}
