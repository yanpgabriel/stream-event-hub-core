# Plano de frontend — Stream Event Hub Core

Data da análise: 16/10/2026. Escopo: planejamento, sem implementar o frontend ou migrar dependências nesta etapa.

## 1. Objetivo e diagnóstico

Construir uma aplicação web simples, em português, para operar todas as funcionalidades expostas pelo backend e fornecer páginas transparentes para fontes de navegador do OBS.

O projeto atual é um servidor Express/CommonJS com Socket.IO, integrações Twitch/YouTube/LivePix e persistência em arquivos em `server/data/`. Não há frontend, overlays, banco relacional ou contrato OpenAPI. O README apresenta apenas parte das rotas; o inventário abaixo foi conferido diretamente em `server/src/routes/`, `socket.js` e serviços.

O painel será para o administrador existente. Não é necessário criar cadastro, múltiplos perfis, permissões por usuário, SSR ou um novo backend.

## 2. Arquitetura proposta

- Frontend em `web/`: React, TypeScript e Vite.
- React Router para navegação; TanStack Query para consultas, cache, invalidação e polling; `fetch` para HTTP; `socket.io-client` da mesma versão principal do servidor para eventos.
- CSS com variáveis e CSS Modules, componentes pequenos e controles HTML acessíveis. Tema escuro, navegação lateral recolhível, layout responsivo e foco na operação em desktop.
- Gráficos inicialmente com SVG simples e tabela equivalente, sem adicionar uma biblioteca de visualização na primeira entrega.
- Estado de formulários local; dados remotos no cache; buffer limitado de chat e logs. Não adicionar Redux ou outro estado global sem necessidade demonstrada.
- Um único repositório com workspaces Bun: `server` e `web`; `private: true` no pacote raiz; um `bun.lock` versionado.

Estrutura sugerida:

```text
docs/PLANO_FRONTEND.md
package.json
bun.lock
server/
web/
  package.json
  vite.config.ts
  src/
    app/                 # rotas, providers, layout e sessão
    components/          # tabela, campos, diálogo, notificações e estados
    lib/                 # cliente HTTP, sockets, tipos e formatação
    features/
      dashboard/
      integrations/
      chat/
      alerts/
      sounds/
      raffles/
      analytics/
      diagnostics/
    overlays/            # reprodução, chat, destaque, widgets e sorteio
```

Desenvolvimento: navegador → Vite em `5173` → proxy para Express em `3232`. Encaminhar `/api`, `/auth`, `/sounds`, `/socket.io` com suporte WebSocket e, se necessário para diagnóstico externo, `/webhooks`. Usar caminhos relativos no cliente. Configurar explicitamente o redirect OAuth do YouTube para a origem do frontend no desenvolvimento, preservando o cookie e a origem usada por `postMessage`.

Produção: Express serve o build de `web/dist`, API e Socket.IO na mesma origem. Alterar o handler atual de `/` e o redirecionamento de `/admin`, que hoje impediriam a entrada direta no painel. Adicionar fallback HTML apenas às rotas de frontend; uma API inexistente deve continuar retornando erro, não `index.html`.

Rotas de interface: `/login`, `/admin`, `/admin/integracoes`, `/admin/chat`, `/admin/alertas`, `/admin/sons`, `/admin/sorteios`, `/admin/metricas`, `/admin/overlays` e `/admin/diagnostico`.

## 3. Telas e cobertura funcional

| Tela | Funcionalidades | Contratos existentes |
| --- | --- | --- |
| Login | Entrar, restaurar sessão, sair, informar expiração e modo de confiança local | `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/logout` |
| Visão geral | Status por plataforma, audiência, resumo da sessão, últimos eventos, iniciar/encerrar captura de métricas e atalhos | `GET /api/status`, `/api/health/connections`, `/api/audience`, `/api/session/summary`; `POST /api/session/start`, `/api/session/end` |
| Integrações | Configurar Twitch/YouTube/LivePix, conectar, acompanhar autorização, ver validade/presença de tokens, reiniciar listeners | `GET /api/config`, `/api/health/tokens`, `/api/livepix/status`; `POST /api/config/validate`, `/api/config`, `/api/livepix/connect`, `/api/listeners/restart`, `/api/listeners/restart/:platform` |
| Chat | Chat unificado com badges e origem, filtro local, destaque, remoção do destaque, mensagem manual, exclusão/timeout/ban e opções de apresentação | `GET /api/chat/state`; `POST /api/chat/test`, `/api/chat/feature`, `/api/chat/feature/clear`; Socket.IO `chat:moderate`; configuração |
| Alertas | Habilitar follow/sub/tip/cheer/raid, duração, fonte, som e TTS por tipo; histórico paginado, filtros, exportação, replay, testes e fila | `GET /api/alert-history`, `/api/alert-history/export`, `/api/queue/status`; `POST /api/alert-replay`, `/api/test-alert`, `/api/queue/clear`; configuração |
| Sons e voz | Listar, ouvir, enviar, renomear e excluir áudios; associar ao alerta, ajustar volume, selecionar/testar voz e velocidade de TTS | `GET /api/sounds`, `/sounds/:arquivo`, `/api/tts/fallback`; `POST /api/sounds/upload`; `PATCH/DELETE /api/sounds/:filename`; configuração |
| Sorteios | Palavra-chave, abrir/fechar inscrições, participantes por plataforma, limpar, sortear, listar ganhadores e reapresentar vencedor | `GET /api/sorteios/state`; `POST /api/sorteios/start`, `/stop`, `/clear`, `/draw`, `/replay` |
| Métricas | Estado da captura, subs e tiers, membros e presentes, bits, doações por moeda, estimativas em BRL, séries, apoiadores e sessões | `GET /api/session/summary`, `/api/analytics/overview`; `POST /api/session/start`, `/api/session/end` |
| Overlays/OBS | Links para copiar, tamanho recomendado, abrir prévia, alertas, chat, destaque, último follow/sub e vencedor | Socket público, `GET /api/widget-data`, áudios e TTS; novas páginas de frontend |
| Diagnóstico | Readiness, saúde/conexões, último erro/evento, tokens, logs ao vivo, status LivePix e reinício por plataforma ou geral | `GET /api/health/ready`, `/api/health/connections`, `/api/health/tokens`, `/api/status`, `/api/livepix/status`; socket `/admin`; rotas de reinício |

Configurações ficam junto da funcionalidade correspondente, com abas avançadas em Integrações e Alertas. Isso cobre os campos editáveis sem uma tela gigante de JSON. Campos operacionais como expiração de tokens, IDs de webhook e último evento ficam como leitura por padrão, com edição avançada apenas onde fizer sentido.

### Integrações e autenticação dos provedores

- Twitch: salvar Client ID/canal e credenciais opcionais; chamar `POST /auth/twitch/device`, mostrar código e link de verificação, acompanhar `POST /auth/twitch/poll` conforme intervalo e validade recebidos; cancelar polling ao sair. Tratar autorização pendente, recusa e expiração.
- YouTube: configurar canal/live ID, Client ID/Secret Google e redirect URI; chamar `POST /auth/youtube/start`; abrir popup e receber `youtube-auth-result`. Validar `event.origin` e `event.source`; atualizar configuração e saúde após sucesso. O callback existente é `GET /auth/youtube/callback`.
- LivePix: apresentar os modos URL de notificação e API como alternativas explícitas. Validar URL/credenciais e conectar via `/api/livepix/connect`. Mostrar webhook, validade do token e último evento.
- Webhook `/webhooks/livepix` e evento `livepix:widget-event` são mecanismos de ingestão. A interface explica configuração e mostra estado; não expõe segredos de ingestão nem precisa reenviar eventos externos manualmente.
- O endpoint legado `/test-trigger` e os comandos socket `chat:feature`/`chat:clear-feature` já têm equivalentes nas telas; não criar botões duplicados apenas para cada transporte.

### Formulários e limites que devem refletir o servidor

- Enviar apenas patches com campos editados; nunca devolver o objeto inteiro recebido de `/api/config`, que contém metadados não aceitos pelo validador.
- Usar `hasSecrets` para mostrar “credencial configurada”. Campo secreto vazio significa preservar o valor existente. Não há operação atual para revogar/apagar um segredo enviando string vazia.
- Validar por `/api/config/validate` antes de salvar e mostrar os erros por campo. Usar a configuração retornada após salvar.
- Duração de alerta: 2–30 segundos. Fonte: 8–128, passo 2. Destaque automático: 0–30 segundos; 0 desliga o desaparecimento automático.
- Som: upload multipart no campo `sound`, áudio de até 5 MB, URL interna `/sounds/`, volume 0–100. Impedir renomear/excluir um som em uso até desvinculá-lo pela própria interface, evitando referências quebradas.
- TTS: sub/tip/cheer, velocidade 0,5–2 e volume 0–1. Converter o slider percentual na UI. Vozes disponíveis dependem do navegador/OBS; prever fallback e teste no ambiente real.
- Teste de alerta: evento, nome, valor, mensagem, tier, destino, repetições de 1–20 e intervalo de 0–5000 ms. Destino inicial sempre `sandbox`; sinalizar efeitos de uma emissão em produção.
- Histórico: paginação por `cursor`, limite de até 200, busca, tipo, listener, datas e exportação CSV/JSON. O parâmetro `source` atual filtra prefixo de listener, não a plataforma; não apresentar filtro de plataforma como suportado pela API. Se esse filtro for necessário, adicionar contrato específico no backend.
- Analytics: períodos `last_session`, `day`, `week`, `month`, `year`, `lifetime`, `custom`; plataformas `all`, `youtube`, `twitch`, `livepix`; agrupamentos `hour`, `day`, `week`, `month`; datas e `tzOffsetMin` conforme convenção do backend. Testar a conversão de horário com um intervalo conhecido em São Paulo.

## 4. HTTP, segurança de sessão e tempo real

Centralizar o acesso HTTP para incluir cookies, anexar `x-csrf-token` às mutações autenticadas inclusive em `/auth/*`, tratar JSON e multipart, normalizar erros e cancelar consultas obsoletas. Não persistir senha, tokens de provedores ou CSRF em `localStorage`.

No início, consultar `/api/auth/me`. Em 401, limpar o estado privado, fechar sockets administrativos e voltar ao login. Em 403 de CSRF, revalidar a sessão e pedir repetição da ação, sem repetir automaticamente operações como sorteio/replay. Usar confirmação e bloqueio de clique duplo nas ações com efeito relevante.

O cookie atual é HttpOnly/SameSite=Lax, as sessões ficam em memória e o TTL é de oito horas; reiniciar o backend exige novo login. O painel deve funcionar com `ADMIN_TRUST_LOCAL_NETWORK=false`. A opção de confiança local deve ser identificada visualmente quando ativa; o código tem default `true`, embora `.env.example` use `false`.

| Conexão | Eventos recebidos/emitidos | Aplicação |
| --- | --- | --- |
| Namespace `/admin` autenticado | `connected`, `unauthorized`, `server-log`, `alert-history-update`, `session-summary-update`, `sorteios-state`, `chat-message`, `chat-featured`, `chat-options` | Painel e invalidação/atualização de cache |
| Namespace `/admin` autenticado | Emitir `chat:moderate` com acknowledgement e timeout | Excluir, timeout de 600 segundos e banir nas plataformas suportadas |
| Namespace `/` público | `connected`, `chat-state`, `chat-message`, `chat-featured`, `chat-options`, `event`, `event:sandbox`, `widget-update`, `sorteio-winner` | Overlays e prévia de alertas |

O namespace administrativo não recebe snapshots iniciais de chat, sessão ou sorteio; carregá-los por REST na entrada e reconexão. Deduplicar mensagens por ID e reconciliar eventos que chegarem durante a consulta inicial. Os eventos de chat são publicados nos dois namespaces: o painel consome chat somente de `/admin`; a conexão pública da prévia se limita aos eventos necessários.

Após reconexão, recarregar os snapshots e invalidar consultas relevantes; observar `connected.instanceId` para detectar reinício. Socket.IO aqui não oferece histórico durável de alertas perdidos: não prometer entrega exatamente uma vez ou reapresentar alertas antigos automaticamente.

Polling proposto, sujeito a ajuste na implementação: saúde/status a cada 10 s; audiência a cada 30 s (cache atual de 25 s); fila a cada 2 s somente com a tela aberta. Resumo e analytics são reconsultados após eventos ou ações relevantes. Suspender polling em abas ocultas, limitar buffers e remover listeners no unmount/logout.

## 5. Overlays que precisam ser construídos

- `/overlays/alertas`: reprodução de alertas de produção, incluindo som e TTS.
- `/overlays/chat`: mensagens recentes e novas, usando o snapshot público do socket.
- `/overlays/destaque`: mensagem destacada e remoção automática/manual.
- `/overlays/widgets`: último follow e sub, carregados por `/api/widget-data` e atualizados por `widget-update`.
- `/overlays/sorteio`: apresentação do vencedor via `sorteio-winner`.
- Prévia em página própria ou iframe: usar o mesmo componente de reprodução, com `event:sandbox`; produção escuta somente `event`.

Todos devem ter fundo transparente, tamanho previsível e URLs copiáveis. Evitar som simultâneo da prévia e da fonte do OBS. Validar áudio, autoplay e vozes no Chromium do OBS.

**Fila visual obrigatória no frontend:** `processOutboundQueue` despacha a cada 40 ms; o backend não aguarda o fim da animação. O overlay mantém uma fila local e respeita `alertDuration` ao tocar cada item. `POST /api/queue/clear` limpa somente itens ainda pendentes no servidor; não interrompe alertas já recebidos pelo navegador. A interface deve mostrar essa diferença.

Configurações de chat chegam por socket e as de alerta no payload de cada alerta. A configuração global completa exige autenticação, portanto o overlay público não pode depender de `/api/config`. Prévia de widgets e destaque usa estado real; somente os alertas possuem um canal sandbox hoje.

## 6. Limitações e adaptações do backend

1. **Hospedagem da SPA:** servir assets/build, ajustar `/` e `/admin` e estabelecer fallback restrito às rotas de interface. Os redirecionamentos OAuth devem continuar chegando ao servidor.
2. **Readiness no Docker:** `/api/health/ready` passa atualmente pelo middleware de autenticação; o healthcheck do Docker não envia cookie. Com confiança local desligada ele pode receber 401. Para publicação, tornar apenas readiness uma sonda pública mínima ou adaptar o healthcheck, preservando as outras APIs protegidas.
3. **Moderação:** os handlers existem, mas a autorização Twitch solicita apenas `chat:read` para chat. Validar permissões exigidas pelo mecanismo usado, papel de moderador e funcionamento real antes de declarar moderação pronta. No YouTube, validar OAuth, IDs de usuário e live chat. Não existe evento de remoção para reconciliar mensagens já armazenadas; implementar esse contrato ou atualizar o estado de forma explícita após sucesso, documentando seu limite entre clientes.
4. **Sorteios:** estado apenas em memória, participantes deduplicados pelo nome, vencedor pode se repetir, resultado vazio retorna `winner: null` e limpar remove também os ganhadores. Mostrar essas regras; persistência, identidade por plataforma e sorteio sem repetição seriam evoluções do backend.
5. **Sessão de métricas:** iniciar abre nova sessão e encerra a anterior; encerrar pausa a captura de métricas. Essas ações não iniciam/encerram uma transmissão Twitch ou YouTube e não param listeners. A UI deve usar rótulos claros.
6. **Receita:** existem taxas de conversão fixas no código. Exibir BRL como estimativa e preservar valores por moeda; não apresentar como cotação atual ou receita financeira conciliada.
7. **Retenção:** chat é temporário (até 500 mensagens/30 min); sorteios e sessões de login se perdem no restart; histórico de alertas tem limite de 2000 itens, replays são podados após dois minutos; métricas têm limite de sessões/eventos. Não prometer arquivo histórico ilimitado.
8. **Configuração do servidor:** usuário/senha admin, porta, origens, trust proxy e segredos de ingestão ficam em ambiente e não têm API de edição. Documentar a instalação e mostrar instruções de diagnóstico quando necessário. Torná-los editáveis pela UI exigiria novo contrato, armazenamento e política de aplicação/restart.
9. **Testes com efeitos reais:** `/api/chat/test` publica uma mensagem manual e pode inscrevê-la no sorteio ativo. Sorteio/replay de vencedor não têm sandbox. Avisar sobre o efeito na interface e testar em instância isolada.

Esses ajustes são delimitados; o restante da operação pode reutilizar os contratos atuais. Não criar controles para parar listener, pausar/pular alerta ou desconectar/revogar provedor sem implementar primeiro a operação correspondente no backend.

## 7. Bun no lugar de npm

Usar Bun como gerenciador de dependências e executor dos comandos de projeto desde a primeira fase. Bun 1.4.2 está disponível neste ambiente; `node` não foi localizado no PATH durante a análise. Fixar a versão de Bun validada na implementação em `packageManager`, CI e imagem de build.

Etapas:

1. Declarar os workspaces `server` e `web` na raiz e criar `web` com `bun create vite web --template react-ts`.
2. Instalar pela raiz com `bun install`, gerar e revisar `bun.lock`. Somente depois de validar a migração, remover os `package-lock.json` substituídos. Não manter gerenciadores concorrentes como fluxo oficial.
3. Trocar os scripts raiz que usam `npm --prefix` por comandos Bun com `--cwd`/filtros. Adotar `bunx` em ferramentas pontuais e no hook atual `npx lint-staged`. Revisar também o comando `npm` embutido na configuração de lint-staged.
4. Definir scripts raiz `dev`, `dev:web`, `dev:server`, `build`, `lint`, `typecheck`, `test:server` e `test:e2e`. O `dev` sobe ambos os serviços com encerramento coordenado e funciona no Windows, sem depender de Bash.
5. CI e Docker instalam com `bun install --frozen-lockfile`. Usar build multiestágio para frontend e dependências do servidor, respeitando a estrutura dos workspaces. Não basta trocar o executável no Dockerfile atual, que copia somente o pacote do servidor.
6. Revisar lifecycle scripts e Husky; autorizar somente os scripts necessários, sem habilitar confiança indiscriminada de dependências. Atualizar README e scaffolding de deploy para os novos comandos/build.

Fluxo esperado após criar os scripts:

```powershell
bun install
bun run dev
bun run lint
bun run typecheck
bun run test:server
bun run build
bun run test:e2e
```

**Decisão sobre runtime:** substituir npm não exige substituir o runtime Node do servidor. A primeira entrega usa Bun para instalar/orquestrar, preservando inicialmente os scripts Node do backend e seus testes `node:test` (com Node provisionado). Avaliar Bun também como runtime em uma etapa separada: CommonJS, Express, Socket.IO, Twurple, tmi.js, youtube-chat, upload, timers, shutdown e suíte existente precisam passar. Só após essa validação trocar `node index.js`, watch, execução dos testes e runtime Docker. Não substituir automaticamente a suíte existente por `bun test` nem presumir equivalência.

## 8. Ordem de implementação e critérios de aceite

| Fase | Entrega | Critério de aceite |
| --- | --- | --- |
| 1 | Workspaces Bun, Vite/React/TS, proxy e scripts | Instalação reproduzível, serviços sobem no Windows, build/lint/typecheck funcionam; testes atuais preservados |
| 2 | Layout, login, cliente HTTP, sockets e dashboard | Restaurar/expirar sessão funciona com confiança local desligada; reconexão ressincroniza dados; erros e carregamento são visíveis |
| 3 | Integrações e configuração | Conexão dos três provedores, validação por campo, segredo preservado e reinício acompanhado; OAuth funciona via proxy e em produção |
| 4 | Alertas, histórico, sons/TTS e overlay de alertas | Teste sandbox visível sem disparar produção; duração/fila visual correta; upload/associação/exportação/replay funcionam |
| 5 | Chat, moderação, sorteios e overlays restantes | Destaque sincroniza entre abas/OBS; moderação validada com permissões reais; sorteio vazio, repetição, limpeza e replay tratados |
| 6 | Métricas e diagnóstico | Períodos/plataformas/fuso corretos; estimativas identificadas; captura de métricas e logs funcionam |
| 7 | Docker, documentação e revisão final | Deep links abrem, APIs inválidas retornam erro, healthcheck passa sem confiança local, dados persistem e OBS reproduz os fluxos |

Validar os fluxos críticos com testes de navegador (por exemplo, Playwright executado via Bun), mais smoke test de integrações em ambiente isolado. Cobrir login/CSRF/401, erro de formulário, preservação de segredos, reconexão sem duplicação de chat, separação dos alertas sandbox/produção, upload, exportação, sorteio e filtros de métricas. Testar o overlay com uma rajada de eventos para demonstrar que cada duração é respeitada.

Mocks verificam a interface sem credenciais; não substituem a validação real de OAuth/moderação e áudio no OBS. Incluir uso por teclado, foco nos diálogos, estados vazios/erro/offline e navegação móvel.

A entrega é completa quando cada capacidade operacional do inventário possui controle ou visualização na interface, as exceções de infraestrutura estão documentadas e o fluxo oficial de instalação/build/teste não depende de npm/npx.

## 9. Referências

Código analisado: `server/src/bootstrap.js`, `auth.js`, `security.js`, `socket.js`, `config.js`, `alerts.js`, `sessionMetrics.js`, `routes/*`, serviços de chat/sorteios/provedores, manifests, hooks, Dockerfile e script de deploy.

- [Bun: workspaces](https://bun.sh/docs/pm/workspaces) — organização dos pacotes e instalação conjunta.
- [Bun: instalação](https://bun.sh/docs/pm/cli/install) — lockfile, instalação congelada e lifecycle scripts.
- [Vite: início](https://vite.dev/guide/) — scaffold React/TypeScript com Bun.
- [Vite: proxy de desenvolvimento](https://vite.dev/config/server-options#server-proxy) — encaminhamento de HTTP/WebSocket.
- [Socket.IO: opções do cliente](https://socket.io/docs/v4/client-options/) — credenciais e configuração da conexão.

Não foram instaladas dependências, iniciados listeners ou executados testes nesta análise; as conclusões sobre comportamento são baseadas na leitura do código, e os pontos de compatibilidade estão marcados para validação na implementação.
