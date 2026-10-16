# Stream Event Hub Core

Central de transmissão para Twitch, YouTube e LivePix, com painel web em português, chat unificado, alertas, sons/TTS, sorteios, métricas e overlays para OBS.

## Iniciar com Bun

Requisitos: **Bun 1.4.2+** e **Node 22+** para o backend. No Windows x64, `bun install` instala um binário opcional de Node 22 no projeto; não é necessário instalar npm. Em outros sistemas, disponibilize Node 22+ no PATH.

```powershell
bun install
Copy-Item server/.env.example server/.env
```

Edite `server/.env`: defina usuário e senha de administrador e configure os provedores pela interface. O arquivo de exemplo já usa `ADMIN_TRUST_LOCAL_NETWORK=false`, exigindo login. Não sobrescreva um `.env` existente.

```powershell
bun run dev
```

- Painel: **http://127.0.0.1:5173/**
- API: http://127.0.0.1:3232/
- O Vite encaminha API, OAuth, sons e Socket.IO para o servidor.
- O backend continua em Node para preservar compatibilidade com as integrações e a suíte `node:test`. Bun instala dependências, executa ferramentas e coordena os serviços.
- Ao encerrar `bun run dev`, os dois serviços são encerrados juntos.

Sem `.env`, o comportamento legado do servidor confia na rede local por padrão. A tela Diagnóstico identifica esse modo. Para exigir login, use o arquivo de exemplo e suas credenciais.

## Funcionalidades na interface

| Área | Recursos |
| --- | --- |
| Visão geral | Audiência, conexões, eventos recentes, contadores e início/fim de captura de métricas |
| Integrações | Configuração e autorização Twitch/YouTube/LivePix, presença/validade de tokens e reconexão |
| Chat | Chat unificado, filtros, mensagem manual, destaque e moderação |
| Alertas | Ativação por tipo, duração/texto, histórico paginado, filtros, exportação, replay, sandbox e fila |
| Sons e voz | Upload de até 5 MB, prévia, renomeação/exclusão, associação por evento e TTS |
| Sorteios | Palavra-chave, inscrições, participantes, ganhadores e reapresentação |
| Métricas | Período/plataforma, séries, apoiadores, moedas, sessões, subs, membros e bits |
| Overlays / OBS | Editor de composição, presets, OBS WebSocket, importação, links e prévias |
| Diagnóstico | Readiness, saúde, erros, tokens, console ao vivo e reinício de conexões |

Credenciais já configuradas são indicadas sem revelar os valores. Campos secretos vazios preservam o segredo existente. Porta, login do administrador, proxy e segredos de ingestão continuam definidos no ambiente.

### OAuth e moderação

- **Twitch:** configure o Client ID e canal, use Salvar e conectar e siga a autorização por código. Para moderar, o token precisa de `moderator:manage:chat_messages` e `moderator:manage:banned_users`; autorize novamente se o token foi obtido antes dessas permissões. A conta deve poder moderar o canal.
- **YouTube:** configure as credenciais Google e registre o redirect exato. No desenvolvimento, use `http://127.0.0.1:5173/auth/youtube/callback`. Em produção, use `https://seu-dominio/auth/youtube/callback`. Não misture `localhost` e `127.0.0.1` no fluxo. Permita o popup de autorização. Moderação requer OAuth e uma live ativa com os IDs necessários.
- **LivePix:** escolha URL de notificações ou API/webhook. O webhook é `POST /webhooks/livepix`; configure o segredo de ingestão no ambiente quando utilizado.

## OBS e testes de alertas

Adicione uma fonte Navegador com um dos links mostrados na tela Overlays / OBS:

```text
/overlays/alertas
/overlays/chat
/overlays/destaque
/overlays/widgets
/overlays/sorteio
/overlays/cena
```

O fundo é transparente. Ajuste o tamanho conforme indicado na interface e mantenha a fonte ativa para receber eventos. Valide áudio/autoplay e vozes dentro do OBS, pois podem diferir do navegador.

Na aba **Links e prévias**, o monitor abre em **Demonstração com exemplos**, permitindo visualizar os layouts sem uma live ativa. Esse modo não conecta às plataformas nem gera eventos. Selecione **Acompanhar dados reais** para monitorar os eventos; uma mensagem informa quando o overlay está aguardando conteúdo. Os links copiados para OBS continuam usando exclusivamente dados reais.

Em Alertas → Testar alertas, o destino padrão é **sandbox**. A prévia escuta somente `event:sandbox`; o overlay de produção escuta `event`. Cada overlay mantém a fila visual pela duração configurada. Limpar a fila do servidor não interrompe eventos já recebidos pelo OBS.

Mensagens manuais entram no estado real do chat e podem participar do sorteio ativo. Sorteios e replay de ganhadores também afetam os overlays reais. Replay de alertas é enviado à produção. As ações correspondentes sinalizam esses efeitos na interface.

### Composição completa e controle compacto

Em **Overlays / OBS → Composição**, configure o canvas, moldura/canto da webcam, barra superior, meta, placar, redes, chat, atividade, letreiro, tema, partículas, flicker, vinheta, QR Code e mensagem de tela cheia. Os efeitos de mensagem são pulso, flicker, glitch e digitação.

**Salvar rascunho** persiste a edição sem mudar a fonte OBS; **Aplicar ao vivo** publica a composição e tenta sincronizar a webcam se o gerenciamento OBS estiver ativado. A prévia escala o canvas inteiro. Use a resolução configurada como tamanho da fonte de navegador `/overlays/cena`. A câmera real continua sendo uma fonte do OBS, atrás da área transparente da moldura.

Em **Webcam e moldura**, desative **Mostrar legenda da webcam** para manter somente a moldura, sem perder o texto salvo. Uma legenda vazia também não desenha a faixa.

Em **Chat na composição → Conteúdo do chat**, escolha entre o chat nativo e **Usar overlay /overlays/chat**. A segunda opção incorpora o mesmo chat de `http://localhost:5173/overlays/chat` no desenvolvimento, com sua aparência publicada, sem duplicar o chat nativo. A URL é relativa ao servidor atual para funcionar também em produção/OBS, sem depender da porta do Vite. Ajuste a largura e altura da área; elas são limitadas ao espaço disponível do canvas. Cores e tipografia vêm de **Aparência dos overlays → Chat**; quantidade e tamanho de texto do chat nativo não se aplicam ao incorporado. A prévia com exemplos mantém o chat incorporado em demonstração, enquanto rascunho com dados atuais e composição publicada acompanham mensagens reais. Salve e aplique a composição para ativar essas escolhas no OBS.

O cronômetro visual é independente da sessão de métricas e oferece iniciar/retomar, pausar e zerar. A meta pode ser manual ou somar um ajuste aos subs Twitch, membros YouTube, bits ou doações estimadas em BRL da sessão atual. Desativar um alerta visual não interrompe mais o registro do evento; novos alertas de teste e replays não incrementam essas métricas.

Atividades manuais afetam somente o tracker. Presets guardam apresentação e cena opcional; não guardam credenciais, cronômetro, valor acumulado da meta ou métricas. **Carregar** altera o rascunho; **Aplicar ao vivo** publica e pode trocar a cena indicada.

O painel compacto `/admin/dock` pode ser adicionado como dock de navegador do OBS. Ele usa o mesmo login e controla elementos publicados, mensagens de tela cheia, presets, cronômetro e atividades. Suas ações são ao vivo e não publicam outros campos pendentes do rascunho.

### Aparência dos overlays individuais

Em **Overlays / OBS → Aparência dos overlays**, personalize separadamente alertas, chat, mensagem em destaque, últimos eventos e ganhador do sorteio: cores de destaque/texto/fundo, opacidade, fonte, tamanhos, alinhamento, borda, arredondamento, espaçamento, largura e altura máximas, nove posições, brilho e animação de entrada. **Usar a cor da cena principal** acompanha a cor publicada da composição.

O monitor mostra exemplos com o rascunho em edição ou a aparência publicada, sem disparar eventos. **Salvar rascunho** não altera o OBS; **Aplicar ao vivo** publica somente a aparência do overlay selecionado e atualiza as fontes conectadas, mantendo a mesma URL. A composição principal e seus presets continuam independentes. **Restaurar padrão** prepara o rascunho para revisão antes de publicar. Tamanho de texto `0` preserva as configurações existentes do chat/alerta; largura ou altura `0` usa o espaço disponível. A altura máxima aceita até 2160 px e recorta o excedente; no chat, limita o conjunto de mensagens e prioriza as mais recentes. O monitor compacto adapta medidas; confira o resultado na resolução final do OBS.

Os monitores da composição e da aparência acompanham a rolagem no desktop, com rolagem interna quando necessário; em telas de até 900 px ficam no fluxo normal. A aparência é persistida em `overlay-store.json` e incluída nos backups da apresentação; arquivos de versões anteriores recebem valores padrão sem perder a composição.

### Conexão OBS e restauração da webcam

Na aba **OBS**, informe host, porta (padrão 4455), protocolo e senha do servidor WebSocket v5 do OBS. Conecte, atualize as cenas/fontes e selecione a cena e o item direto da webcam. Ative **Gerenciar a webcam nesta cena**, salve e conecte novamente. Grupos e fontes em cenas aninhadas exigem selecionar/remapear um item direto.

O Hub captura o transform e a visibilidade originais antes do primeiro ajuste. **Restaurar original** repõe esses valores e desativa o gerenciamento. Alterar a configuração desconecta o OBS; uma conexão ativada é retomada no próximo boot. Falhas de troca de cena não são guardadas para execução posterior. A senha é persistida em `secrets.json`, nunca no snapshot público.

Use uma cena duplicada para ensaio. Em Docker Desktop, o host do OBS poderá ser `host.docker.internal`; um servidor remoto precisa alcançar a máquina do OBS. O Hub não configura firewall nem inicia/encerra o streaming. Use somente uma fonte de áudio de alertas por cena: a composição completa é visual, e `/overlays/alertas` continua responsável por seus sons/TTS.

### Importar o projeto antigo

Na aba **Migração**, selecione de `D:\stream\overlays`:

- `config.json`, obrigatório;
- `presets.json`, opcional, nos formatos legado ou `{config, obsScene}`;
- `obs-config.json`, opcional; a senha não é mostrada no relatório;
- `overlay.html`, opcional, para recuperar o perfil de rede social antes fixo no HTML.

**Validar e visualizar** não altera dados. A importação exige uma segunda ação, cria backup privado e prepara o rascunho. O valor manual da meta e as atividades importadas também ficam pendentes até publicar. A configuração OBS é importada apenas se selecionada e fica desconectada, com gerenciamento desativado. O horário antigo de início de live não é ativado e `secret.token` não é importado. Nenhum arquivo do projeto antigo é escrito.

O mesmo painel lista backups para restauração. A restauração da apresentação muda a composição publicada; a configuração OBS pode ser restaurada separadamente quando houver cópia correspondente, sempre desativada para revisão. Credenciais Twitch/YouTube/LivePix e histórico de eventos não são substituídos.

Depois do ensaio, substitua `http://localhost:8080/overlay.html` pela fonte `/overlays/cena` do Hub, atualize docks e retire o controlador antigo dessa mesma webcam. A integração da roleta antiga ficou fora desta entrega; o sorteio por chat existente continua disponível.

## Verificação e build

```powershell
bun run lint
bun run test
bun run build
bun run start
```

O build gera `web/dist`. Após iniciar o servidor, o painel e os overlays ficam em **http://localhost:3232/**, na mesma origem da API. O frontend não depende de Vite em produção.

- `bun run test:server`: suíte original, APIs/Socket.IO, publicação, presets, migração/reversão, OBS simulado e contagens; usa arquivos temporários e autenticação/CSRF ativos.
- `bun run test:web`: fila visual, prévias, composição, QR local e metas.
- `bun run typecheck`: TypeScript do frontend.
- CI: `bun install --frozen-lockfile`, `bun run lint`, `bun run test`, `bun run build`.
- `bun.lock` é o único lockfile do projeto.

## Docker

```powershell
docker build -t stream-event-hub-core .
docker run --rm -p 3232:3232 --env-file server/.env -v "${PWD}/server/data:/app/data" stream-event-hub-core
```

O Dockerfile usa Bun para instalar/construir e Node 22 no runtime. O volume permanece em `/app/data`. A sonda pública mínima `/api/health/ready` funciona sem sessão; os endpoints administrativos continuam protegidos.

O `deploy.sh` continua usando SSH/rsync e esse Dockerfile. Configure `.deploy.env` a partir do exemplo; este repositório não contém configurações de produção. Não foi realizado deploy remoto como parte da implementação do painel.

## Dados e limites

- Dados locais: `server/data/`, ou diretório absoluto indicado por `STREAM_HUB_DATA_DIR`.
- Configuração pública: `config.json`; segredos: `secrets.json`; sons: `sounds/`. Esses arquivos não são versionados.
- Apresentação/presets/runtime: `overlay-store.json`; conexão OBS: `obs-settings.json`; transforms originais: `obs-original-transforms.json`; backups: `overlay-backups/` e `overlay-obs-backups/`, este último privado e podendo conter a senha anterior.
- Sessões de login e sorteios ficam em memória; reiniciar o servidor perde esses estados.
- Chat: até 500 mensagens, com retenção de 30 minutos. O painel mostra até 200 por consulta.
- Histórico de alertas: até 2000 itens; replays são podados após dois minutos.
- As estimativas em BRL usam taxas fixas do servidor, não cotações atuais. Subs, membros e bits não representam receita líquida.
- Iniciar/encerrar sessão controla captura de métricas, não inicia/encerra a transmissão nem os listeners.
- Não há entrega durável de eventos perdidos por um overlay desconectado.

## Estrutura

```text
server/    Express, Socket.IO, integrações, persistência e testes
web/       React, TypeScript, Vite, painel e overlays
shared/    Modelo de apresentação e geometria compartilhada com o OBS
scripts/   Orquestração Bun e seleção do runtime Node
docs/      Plano técnico e referência de escopo
bun.lock   Dependências dos workspaces
```

O [plano de frontend](docs/PLANO_FRONTEND.md) registra a análise original e as decisões de implementação.

## Licença

ISC
