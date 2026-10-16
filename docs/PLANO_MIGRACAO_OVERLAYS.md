# Plano de substituição do projeto antigo de overlays

Origem: `D:\stream\overlays`. Destino: `D:\stream\stream-event-hub-core`.

Escopo desta etapa: análise do código e planejamento. Não foram iniciadas aplicações, estabelecidas conexões com o OBS, alterados arquivos da origem ou executada a migração.

**Atualização após autorização de implementação:** composição/editor, publicação, presets, OBS, importação/reversão, dock e metas foram implementados no Hub. A roleta e sua lista manual foram excluídas desta entrega a pedido do usuário; os itens relacionados a elas abaixo permanecem somente como registro do plano original. A importação dos arquivos reais e o ensaio no OBS ainda são passos operacionais do usuário. Consulte o README para o fluxo atual.

## 1. Conclusão da comparação

O projeto antigo é principalmente um controlador de apresentação da live: uma composição única de 1920 × 1080, elementos visuais configuráveis, presets e controle de cena/webcam no OBS. O Stream Hub atual concentra integrações, chat real, alertas, sorteios por chat e métricas.

A substituição exige unir essas duas partes. A prioridade é adicionar ao Hub um **editor de composição da transmissão e uma integração com OBS**, aproveitando seus serviços de eventos existentes. Copiar apenas o HTML antigo ou criar mais links de overlays não substitui os controles operacionais antigos.

O frontend permanece em React/TypeScript/Vite, os comandos e dependências continuam com Bun e o backend mantém o runtime Node já adotado. Não é necessário trazer um segundo servidor Bun.serve ou outro protocolo WebSocket.

## 2. Evidências do projeto antigo

Arquivos principais analisados:

- `server.js`: persistência, configuração padrão, autenticação do painel, mensagens WebSocket, presets e cliente OBS WebSocket.
- `dashboard.html`: quatro abas de operação — Elementos, Conteúdo, Interação e Sistema.
- `overlay.html`: composição, animações, contador, QR Code, letreiro, mensagem de tela cheia e roleta.
- `package.json`: `obs-websocket-js`, `qrcode-generator` e ícones Lucide.
- Arquivos locais de configuração: inspeção das estruturas e indicadores necessários à migração, sem registrar senha ou token neste documento.

Na configuração local observada, a webcam está no canto superior esquerdo, há conteúdo de QR configurado, o efeito de mensagem selecionado é pulso e existe um horário de início de live persistido. O OBS está configurado para loopback, porta 4455, com senha, cena e webcam mapeadas. Portanto, integração OBS e migração dessas referências fazem parte do uso atual; não são apenas recursos hipotéticos.

`presets.json` está vazio e o log manual de atividade também estava vazio na inspeção. A funcionalidade de presets existe e deve ser mantida mesmo sem registros atuais.

Há uma alteração local não commitada em `overlay.html`, relativa à identificação de rede social. A migração deve considerar o arquivo de trabalho atual e transformar essa personalização em campo editável, preservando a origem intacta.

Distinções importantes encontradas no código:

- A caixa de chat antiga contém somente o título. Ela não recebe nem renderiza mensagens. O chat real do Hub deve preencher esse espaço.
- A roleta antiga recebe nomes digitados, escolhe o vencedor no navegador do administrador e apenas transmite a animação. O Hub já escolhe no servidor, mas ainda não aceita essa lista manual nem renderiza a roleta.
- O botão antigo “Iniciar Live” só altera `liveSince` para controlar um cronômetro. Ele não manda o OBS iniciar ou encerrar uma transmissão.
- A atividade recente é inserida manualmente: guarda até cinco itens e mostra três no overlay.
- A meta antiga é manual. Não há soma automática por eventos Twitch/YouTube/LivePix.
- Aplicar um preset pode trocar a cena do OBS. O preset também guarda estado operacional junto do layout, incluindo campos que não devem ser restaurados inadvertidamente na nova implementação.

## 3. Matriz de migração

Prioridades: **P0** = necessário para substituir o fluxo antigo; **P1** = integração com recursos já existentes do Hub; **P2** = evolução após a troca.

| Funcionalidade antiga | Situação no Hub atual | Destino proposto | Prioridade |
| --- | --- | --- | --- |
| Composição única 1920 × 1080 | Cinco overlays separados | `/overlays/cena` com módulos reutilizáveis e editor | P0 |
| Mostrar/esconder elementos durante a live | Sem composição configurável | Controles de visibilidade por elemento | P0 |
| Moldura de webcam e quatro cantos | Ausente | Configuração de webcam no editor, compartilhada com geometria OBS | P0 |
| Mover/esconder a fonte real da webcam | Ausente | Serviço OBS com cena/item explicitamente mapeados | P0 |
| Barra superior com dados e cronômetro | Widgets parciais, sem barra composta | Módulo de barra superior e cronômetro de apresentação | P0 |
| Meta com nome, valor atual e alvo | Ausente | Meta manual com barra de progresso | P0 |
| Placar/destaque de texto genérico | Último follow/sub, sem placar genérico | Campo manual e seletor de fonte de dados | P0; automático em P1 |
| Cor do tema | Aparência fixa nos overlays | Tema da apresentação, independente do tema do painel | P0 |
| Letreiro de patrocinadores/redes | Ausente | Texto editável, visibilidade e rolagem contínua | P0 |
| QR Code de texto ou URL | Ausente | QR gerado localmente e componente configurável | P0 |
| Mensagem de tela cheia | Ausente | Texto, ativação e efeitos flicker/pulso/glitch/digitação | P0 |
| Partículas, flicker e vinheta | Ausentes | Efeitos opcionais, com controle de custo visual | P0, após conteúdo principal |
| Presets salvar/carregar/excluir | Ausente | Presets de apresentação, com cena OBS opcional | P0 |
| Conectar OBS e atualizar cenas/fontes | Apenas links de fontes de navegador | Tela OBS com estado, configuração e inventário | P0 |
| Atividade recente manual | Histórico automático, sem curadoria na composição | Inserção/remoção manual na faixa visual | P0; integração automática em P1 |
| Lista manual + roleta animada | Inscrição por palavra-chave e anúncio simples | Entrada manual no sorteio existente e apresentação de roleta | P0 |
| Caixa visual de chat | Chat unificado funcional | Reutilizar mensagens reais dentro da composição | P1, antes da troca final |
| Atualização ao vivo e estado inicial | Socket.IO já existente | Snapshot público de apresentação + eventos versionados | P0 |
| Tela “Sinal perdido” | Reconexão e espera parcial nas prévias | Política configurável de desconexão, com diagnóstico no painel | P0 |
| Importação de configurações antigas | Ausente | Assistente com validação, prévia, backup e reversão | P0 |
| Metas automáticas | Não existiam no antigo | Integração com eventos normalizados e regras de contagem | P2 |
| Editor livre com arrastar/redimensionar | Não existia no antigo | Avaliar depois; inicialmente usar controles e posições previstas | P2 |

O objetivo de P0 é preservar as capacidades existentes, sem depender de recursos novos como metas automáticas ou um editor gráfico completo.

## 4. Como ficará a interface

Manter as áreas atuais e ampliar **Overlays / OBS** com quatro abas:

1. **Composição:** prévia, elemento selecionado, liga/desliga, canto da webcam, tema, meta, barra superior, redes, letreiro, QR, atividade e mensagem de tela cheia.
2. **Presets:** salvar, duplicar, carregar, renomear, excluir, ver diferenças e associar uma cena do OBS opcionalmente.
3. **OBS:** host/porta/protocolo, senha protegida, conexão, inventário de cenas/fontes, cena de composição e item da webcam.
4. **Migração:** carregar os arquivos antigos, validar, visualizar o resultado, selecionar o que importar e aplicar com backup.

A tela Sorteios ganha opção de participantes **do chat, manuais ou mistos** e seleção da apresentação **anúncio simples ou roleta**. O sorteio continua pertencendo a um único serviço no backend.

Adicionar uma visão compacta de operação com visibilidade dos elementos, mensagem de tela cheia, presets favoritos e ações da live. Ela pode ser aberta como dock de navegador do OBS; reaproveita autenticação e os mesmos serviços do painel. Não precisa existir outro dashboard HTML independente.

### Prévia e aplicação ao vivo

- Manter “Demonstração com exemplos” e “Acompanhar dados reais”, implementados recentemente.
- Acrescentar um rascunho de composição: editar ou carregar um preset na prévia não deve mover webcam nem trocar cena.
- **Aplicar ao vivo** publica o rascunho. Quando houver cena OBS vinculada, a interface identifica a cena antes de executar a ação.
- A prévia da composição usa o canvas base e escala proporcionalmente para caber no monitor, com o mesmo componente de renderização da fonte OBS. Não reduzir fontes isoladamente nem usar um iframe de 270 px para representar coordenadas nativas sem escala.
- Exemplos, roleta de teste e QR de demonstração não alteram contadores, participantes, sessões ou OBS.

## 5. Organização técnica e contratos propostos

Separar configuração de apresentação, estado operacional e segredos. Ampliar o formulário atual de integrações ou o objeto plano de configuração indiscriminadamente tornaria presets e importação mais frágeis.

| Domínio | Conteúdo | Persistência sugerida |
| --- | --- | --- |
| Apresentação | Canvas, elementos, posições, estilos, fontes de dados, rascunho/publicação e revisão | `server/data/overlay-config.json` |
| Presets | ID, nome, versão do schema, apresentação e cena vinculada opcional | `server/data/overlay-presets.json` |
| Estado operacional | Meta manual, cronômetro, itens manuais e último estado de apresentação necessário | `server/data/overlay-runtime.json` |
| OBS | Conexão sem senha, cena/item mapeados e autorização de gerenciamento | Configuração privada validada do servidor |
| Segredos OBS | Senha e indicador de presença, sem valor devolvido ao navegador | `server/data/secrets.json`, integrado ao mecanismo existente |

Usar escrita atômica, validação de schema, revisão para detectar conflitos e patches por campo. Autosalvar rascunhos com debounce, retornando erros e confirmação de persistência; no encerramento, concluir escritas pendentes.

Presets guardam layout e vínculos de dados, não tokens, senha OBS, participantes, ganhadores, totais de métricas, início da sessão ou histórico corrente. Restaurar o visual não deve reiniciar uma sessão nem trocar o valor acumulado de uma meta.

Contratos a adicionar, sujeitos ao detalhamento na implementação:

| Operação | Contrato proposto |
| --- | --- |
| Ler/editar rascunho de apresentação | `GET/PATCH /api/overlay/config` — administrador |
| Validar/publicar composição | `POST /api/overlay/config/validate`, `POST /api/overlay/publish` — administrador + CSRF |
| Estado usado pela fonte de navegador | `GET /api/overlay/state` — projeção pública estritamente visual |
| Atualizar cronômetro/meta manual | `POST /api/overlay/runtime/timer`, `PATCH /api/overlay/runtime/goal` — administrador |
| Curadoria de atividade visual | `POST/DELETE /api/overlay/activity[/:id]` — administrador; não apaga histórico de eventos |
| CRUD e aplicação de presets | `/api/overlay/presets` e operações por ID — administrador |
| Estado e inventário OBS | `GET /api/obs/status`, `/api/obs/scenes`, `/api/obs/scenes/:id/items` — administrador |
| Conexão/configuração OBS | `POST /api/obs/config`, `/connect`, `/disconnect`, `/refresh` — administrador + CSRF |
| Entrada manual de participantes | Estender `/api/sorteios` com adição/remoção/importação de lista |
| Importar legado | Validação e aplicação separadas em `/api/migration/overlays/*`, recebendo arquivos, não caminhos arbitrários do servidor |

Eventos Socket.IO adicionais: `overlay:state` para snapshot/atualização visual; `obs:status` e alterações de inventário somente em `/admin`; `sorteio:spin` para apresentar um resultado já escolhido no servidor.

O snapshot visual deve conter somente o necessário para renderização. Não reutilizar `GET /api/config` completo nem publicar endereço, senha ou inventário privado do OBS. Não reintroduzir token em `localStorage`, mensagens de configuração arbitrária ou conexão fixa `ws://host:8080` do legado.

Arquivos/módulos previstos:

```text
server/src/services/overlay.js
server/src/services/overlayPresets.js
server/src/services/obs.js
server/src/services/overlayMigration.js
server/src/routes/overlay.js
server/src/routes/obs.js
server/src/routes/overlayMigration.js
web/src/features/overlays/           # editor, presets, OBS e migração
web/src/overlays/SceneOverlay.tsx
web/src/overlays/elements/           # webcam, barra, QR, letreiro, meta etc.
```

Atualizar rotas React, fallback em `server/src/frontend.js`, autenticação/allowlist pública, tipos, prévias e documentação junto com as novas páginas. O serviço OBS participa do shutdown, mas alterações de apresentação não reiniciam listeners de Twitch/YouTube/LivePix.

## 6. Mapeamento do legado

| Campos antigos | Modelo novo / decisão |
| --- | --- |
| `webcam`, `webcamPos` | Visibilidade/canto da moldura e configuração compartilhada com o item real no OBS |
| `topbar`, `showGoal`, `showStat` | Visibilidade da barra e de cada item, mantendo escolhas individuais |
| `chat`, `events`, `sponsors`, `qrcode` | Visibilidade dos módulos correspondentes |
| `particles`, `flicker`, `vignette`, `themeColor` | Efeitos e tema da composição |
| `sponsorText` | Texto do letreiro |
| `goalLabel`, `goalTarget` | Definição da meta; `goalCurrent` vira valor manual operacional |
| `statLabel`, `statValue` | Placar em modo manual; vínculo automático é uma opção posterior |
| `qrText` | Conteúdo do QR validado, gerado localmente; não presumir que uma URL qualquer seja uma cobrança Pix |
| `screenMessageEnabled`, `screenMessageText`, `screenMessageEffect` | Módulo de mensagem, quatro efeitos compatíveis |
| `activityLog` | Itens manuais de exibição, com origem marcada; sem gerar doações/subs fictícios |
| `liveSince` | Horário anterior oferecido para revisão; não importar como transmissão ativa automaticamente |
| Preset `{config, obsScene}` ou configuração direta legada | Conversão com schema versionado e extração somente dos campos de apresentação |
| OBS `host`, `port`, `password`, `overlayScene`, `webcamSource` | Conexão privada, segredo separado e mapeamento revisado antes de controle real |
| Texto de rede social e legenda da webcam hardcoded no HTML | Novos campos editáveis de identidade; pré-preencher a personalização encontrada para revisão |
| `secret.token` | Não migrar. A sessão administrativa atual substitui esse mecanismo |

O importador deve funcionar com arquivos ausentes, JSON inválido, presets vazios, valores fora de faixa e campos desconhecidos. Informar o que foi aceito, ajustado ou descartado. Nunca sobrescrever as credenciais Twitch/YouTube/LivePix ou dados atuais do Hub ao importar apresentação.

Uma ferramenta CLI local opcional pode usar `bun run migrate:overlays --from "D:\stream\overlays" --dry-run`. Esse comando é uma proposta futura: não foi criado nem executado nesta etapa. A aplicação real deve ser uma ação separada do diagnóstico.

## 7. Pontos que exigem cuidado na implementação

### OBS e geometria da webcam

Reutilizar a biblioteca `obs-websocket-js` com protocolo v5. As operações usadas pelo legado existem no protocolo oficial: `GetSceneList`, `GetSceneItemList`, `GetSceneItemId`, `GetVideoSettings`, `SetSceneItemEnabled`, `SetSceneItemTransform` e `SetCurrentProgramScene`.

Centralizar a geometria em um único modelo para moldura e fonte real. No antigo, a moldura tem 380 × 215 px, margem lateral/inferior de 60 px, superior de 80 px e recuo interno de 3 px. Esses valores aparecem tanto no CSS quanto no servidor; não manter essa duplicação no novo projeto. O importado deve inicialmente reproduzir essa geometria e o encaixe existente, oferecendo ajuste proporcional/corte sem alterar a webcam silenciosamente.

Ler a resolução do OBS e resolver corretamente coordenadas no canvas escolhido. Validar nome/ID do item, grupos e cenas aninhadas antes de movimentar uma fonte; a primeira entrega pode indicar explicitamente quando um item aninhado exige remapeamento. Gerenciar só a cena/item escolhidos. Preservar a ordem e a configuração das demais fontes.

Capturar o transform original antes do primeiro ajuste para permitir restauração. Exibir falhas de conexão, senha, fonte ou cena sem bloquear chat/alertas. Reconectar com backoff, sem conexões duplicadas. Uma troca de cena que falhou não deve ficar enfileirada para disparar inesperadamente ao reconectar.

O servidor precisa alcançar a máquina do OBS. No Docker, `localhost` aponta para o container; no ambiente Windows/Docker Desktop poderá ser necessário `host.docker.internal`, com conectividade validada. Um servidor remoto não alcança automaticamente o OBS local. A configuração deve explicar isso, sem abrir portas ou alterar firewall automaticamente.

### Sorteio e roleta

Aceitar lista manual mantendo a inscrição por chat. Escolher e registrar o resultado **uma única vez no servidor**; transmitir ID do sorteio, participantes congelados, vencedor, horário de início e duração. O navegador apenas anima. Não copiar o `Math.random()` do dashboard antigo nem sortear de novo ao repetir a animação.

Reapresentação usa o mesmo resultado. Definir tratamento de um único participante, lista vazia, nomes repetidos e sorteio em andamento. Para preservar o legado, a lista manual é suportada; identidade por plataforma e opção de não repetir vencedores podem ser melhorias explícitas. Evitar vazar IDs internos de usuários no payload público.

### Eventos, metas e histórico visual

Conectar chat ao serviço já existente e montar atividade recente a partir de eventos normalizados, mantendo a curadoria manual. Remover um item do tracker visual não remove receita nem evento histórico.

Há uma dependência no backend atual: alertas desativados podem retornar de `emitAlert` antes da gravação de histórico/métricas. Uma futura meta automática não pode depender desse caminho, senão desligar uma animação afeta a contagem. Para P2, separar ingestão/registro do evento da decisão de mostrar alerta, identificar origem `provider/manual/test/replay` e deduplicar por ID. Testes/replays não incrementam metas reais; ajustes manuais são operações identificadas.

### Sessão, fontes e efeitos

- Manter cronômetro de apresentação separado da captura de métricas. Pode existir uma opção explícita de vinculá-los, mas nenhum botão de cronômetro deve iniciar/encerrar o streaming real.
- O layout composto e os overlays individuais devem reutilizar componentes. Definir quais elementos cada fonte renderiza para evitar anunciar o mesmo vencedor duas vezes ou tocar áudio duplicado. Manter uma única fonte responsável pelo áudio de alertas por cena.
- Adotar ordem de camadas documentada para gameplay/webcam, composição, chat/destaque, alertas, roleta e mensagem de tela cheia. A prévia não deve conter a câmera real nem controlá-la.
- QR precisa continuar funcionando sem serviço externo de geração. Textos são conteúdo, não HTML executável; validar cor, tamanhos, conteúdo e tipos de efeito.
- Para desconexão, oferecer a opção de conservar a última composição ou mostrar “Sinal perdido”. O modo escolhido deve ser testado no OBS, evitando uma tela opaca inesperada durante a transmissão.
- Efeitos e letreiro não devem reiniciar a cada alteração não relacionada. Limitar partículas, limpar timers/listeners e prever redução de movimento. Considerar fontes locais para não depender da disponibilidade do Google Fonts durante uma live.

## 8. Sequência de execução

| Etapa | Entrega | Critério de aceite |
| --- | --- | --- |
| 1 — Fundação e importação de diagnóstico | Schema de apresentação/presets/runtime, validador, cópia de segurança e relatório de importação sem aplicar | A configuração atual do antigo é reconhecida, sem alterar origem, segredos ou dados do Hub |
| 2 — Composição e editor | Canvas, webcam visual, tema, barra/meta/placar, letreiro, QR, mensagens e efeitos; rascunho/publicação | Os controles antigos possuem equivalente, exemplos sempre aparecem e a composição cabe na prévia sem recortes |
| 3 — OBS e presets | Configuração protegida, cenas/fontes, sincronização da webcam, presets e cena vinculada | Os quatro cantos alinham moldura e vídeo; aplicar um preset mostra o resultado e respeita o escopo da cena |
| 4 — Interação e dados reais | Chat no layout, atividade manual/automática, cronômetro e lista manual com roleta no sorteio existente | Operação completa de uma live de ensaio sem dashboard antigo; vencedor é consistente em painel/overlay |
| 5 — Migração assistida e troca | Importação revisada, teste em cena duplicada, documentação de URLs e reversão | Os dados/configurações necessários estão preservados e o OBS usa a nova fonte sem depender da porta 8080 |
| 6 — Evolução | Metas automáticas e refinamentos de edição/automação | Contagem independente de alertas, deduplicação, exclusão de testes/replay e validação dos novos fluxos |

As etapas 1–5 formam o marco de substituição. Etapa 6 não deve impedir a troca, pois automatiza capacidades que o antigo nem possuía.

Novas dependências prováveis: `obs-websocket-js` no servidor e uma biblioteca local de QR no frontend, podendo reaproveitar `qrcode-generator`. Adicionar por Bun, revisar compatibilidade e atualizar apenas o `bun.lock` existente. Lucide já está presente no frontend; não copiar dependências ou `node_modules` do legado.

## 9. Verificação e desativação do antigo

Antes da troca, verificar com dados isolados:

- Schema, importação dos dois formatos de preset, preservação de segredos, backup e reversão.
- Prévia de cada elemento, composição completa, modo de espera, rascunho sem efeitos reais e publicação sincronizada entre abas.
- QR legível, letreiro contínuo, quatro efeitos da mensagem, estados de visibilidade e cronômetro após reconexão.
- OBS simulado para validar parâmetros e falhas; depois OBS real em uma cópia da cena, nas resoluções usadas, com a webcam nos quatro cantos.
- Aplicação de preset sem OBS conectado: a UI informa a falha/parte aplicada; não declara sucesso completo nem muda cena mais tarde sem nova ação.
- Sorteio manual/chat, lista vazia, repetição de animação, desconexão no meio do giro e consistência do ganhador.
- Chat e atividade reais, ausência de áudio duplicado, comportamento de “Sinal perdido”, desempenho no Chromium do OBS e build/Docker com conexão OBS configurável.

Roteiro para substituir:

1. Exportar cópia da coleção/cena OBS e guardar os arquivos atuais dos dois projetos, incluindo configuração e segredos em local privado.
2. Revisar o relatório de importação; aplicar no Hub somente as configurações selecionadas.
3. Ensaiar na cena duplicada. Não deixar os dois servidores controlarem simultaneamente a mesma fonte de webcam.
4. Trocar a fonte antiga `http://localhost:8080/overlay.html` pela composição publicada do Hub, normalmente `http://localhost:3232/overlays/cena` em execução local de produção. Atualizar também o dock do painel, se utilizado.
5. Encerrar o antigo e repetir o roteiro completo de operação. Confirmar que nenhuma cena/fonte/dock ainda depende da porta 8080.
6. Manter a cópia antiga disponível para reversão até concluir uma transmissão real com o novo fluxo. Em reversão, desligar o gerenciamento OBS do Hub antes de reativar o controlador antigo e restaurar a cena exportada.

O antigo pode ser desativado quando todos os controles P0, a apresentação de chat e os fluxos efetivamente usados tiverem equivalente validado, a geometria da webcam estiver correta e o novo painel for suficiente para operar a transmissão inteira. Não apagar o projeto antigo como parte automática da migração.

## 10. Referências

- Código local antigo: `server.js`, `dashboard.html`, `overlay.html` e `package.json`.
- Código local atual: serviços de chat/sorteios/alertas/métricas, configuração, Socket.IO, rotas e componentes de overlays/prévias.
- [Protocolo oficial OBS WebSocket](https://github.com/obsproject/obs-websocket/blob/master/docs/generated/protocol.md) — contratos de cenas, itens e transformações.
- [Cliente obs-websocket-js](https://github.com/obs-websocket-community-projects/obs-websocket-js) — cliente utilizado no antigo e candidato a reutilização.
- [OBS WebSocket incluído no OBS Studio 28+](https://github.com/obsproject/obs-websocket/blob/master/README.md) — compatibilidade e configuração do serviço.

Este documento registra uma análise estática e decisões propostas. A conexão real com OBS, o aspecto visual em execução e a migração de dados não foram testados nesta etapa, respeitando a solicitação de deixar a inicialização das aplicações com o usuário.
