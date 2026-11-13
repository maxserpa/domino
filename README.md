# Bot do Dominó (Telegram → GitHub → tabela)

Você encaminha a mensagem do grupo para o bot, ele mostra uma prévia, você aperta **OK**, e o bot faz o commit.
O GitHub regenera e publica a tabela sozinho.

```
Telegram (você encaminha) → Cloudflare Worker (bot) → commit em data.json → GitHub Actions → GitHub Pages
```

## O que tem aqui
| Arquivo | Função |
|---|---|
| `data.json` | Fonte de verdade: todos os jogos e pagamentos (já com tudo que ajustamos) |
| `template.html` | Layout da tabela (o mesmo que você já usa) |
| `src/ledger.js` | Regras: placar, caixa, pendências |
| `src/parser.js` | Entende `WIN:/LOS:`, `fulano pago`, `pagou 20 reais`, `Max pago 25/05` |
| `src/render.js`, `scripts/build.mjs` | Geram `dist/index.html` |
| `worker/index.js` | O bot (Cloudflare Worker) |
| `.github/workflows/pages.yml` | Roda testes, gera e publica a página a cada commit |
| `test/` | Testes (incluem a conferência de que a tabela gerada é igual à aprovada) |

## Instalação (uma vez só, ~20 min)

### 1. Repositório e página no GitHub
1. Crie um repositório (ex.: `domino`) no GitHub.
2. Nesta pasta: `git init && git add . && git commit -m "Primeira versão" && git branch -M main`
   `git remote add origin https://github.com/SEU_USUARIO/domino.git && git push -u origin main`
3. No repositório: **Settings → Pages → Source: GitHub Actions**. Depois do primeiro push, o link da tabela aparece em Actions/Pages.

> O GitHub Pages grátis exige repositório **público**, então a tabela (nomes e pagamentos) fica acessível a quem tiver o link. Se não quiser isso, me avise que adapto para Cloudflare Pages com repositório privado.

### 2. Token do GitHub para o bot gravar
**Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate**
- Repository access: *Only select repositories* → o repositório do dominó
- Permissions: **Contents: Read and write** (nada além disso)
- Guarde o token.

### 3. Criar o bot no Telegram
No Telegram, converse com **@BotFather** → `/newbot` → escolha nome e usuário → guarde o **token**.

### 4. Publicar o Worker (Cloudflare, plano grátis)
```bash
npm install
npx wrangler login
npx wrangler kv namespace create PENDING          # copie o id que aparecer
```
Edite `worker/wrangler.toml`: cole o id do KV e preencha `GITHUB_REPO` (`usuario/repositorio`).

```bash
npx wrangler secret put TELEGRAM_TOKEN  --config worker/wrangler.toml   # token do BotFather
npx wrangler secret put GITHUB_TOKEN    --config worker/wrangler.toml   # token do passo 2
npx wrangler secret put WEBHOOK_SECRET  --config worker/wrangler.toml   # invente uma senha longa
npm run deploy:worker
```
O deploy mostra a URL do Worker (`https://domino-bot.SEU-SUBDOMINIO.workers.dev`).

### 5. Ligar o Telegram ao Worker
```bash
curl "https://api.telegram.org/botSEU_TOKEN/setWebhook" \
  -d url=https://domino-bot.SEU-SUBDOMINIO.workers.dev/webhook \
  -d secret_token=A_MESMA_SENHA_DO_WEBHOOK_SECRET
```

### 6. Liberar só você
Abra o bot no Telegram e mande `/id`. Ele responde seu número. Coloque em `ALLOWED_IDS` no `wrangler.toml` (vários IDs separados por vírgula) e rode `npm run deploy:worker` de novo.

## Como usar
- **Encaminhe** para o bot uma mensagem do grupo. Pode ter jogo e pagamento juntos.
- Ele responde com a prévia e dois botões: **✅ OK** grava e faz o commit; **↩️ Desfazer** descarta.
- A data do lançamento é a da **mensagem original** (a data do encaminhamento é ignorada).
- Formatos aceitos:
  - `WIN: Nildo e Romeu` / `LOS: Hugo e Luizinho` (a ordem das linhas tanto faz)
  - `Nildo pago` · `Augusto pagou 20 reais` (R$ 20 = 2 lisas)
  - `Max pago 25/05` quita especificamente a lisa de 25/05
- Comandos: `/placar`, `/pendentes`, `/desfazer` (apaga o último lançamento feito pelo bot), `/ajuda`.
- O bot avisa sobre **nome novo** (pode ser erro de digitação) e sobre **jogo igual já existente** na mesma data.

## Regras de cálculo
- Cada perdedor deve R$ 10 por lisa. O caixa é a soma dos pagamentos registrados.
- Um pagamento quita a lisa **mais antiga em aberto** da pessoa, ou a lisa da data informada.
- Pagamento antes de perder vira crédito e abate a próxima lisa.
- Os lançamentos são processados na ordem em que estão no `data.json`.

## Corrigindo erros
- Lançou errado agora há pouco: `/desfazer`.
- Qualquer outro ajuste: edite `data.json` direto no GitHub (botão de lápis). Cada item de `events` é um jogo ou um pagamento; apague ou altere a linha e dê commit. A tabela se atualiza.
- Apelido ou erro de digitação recorrente: acrescente em `aliases` no `data.json` (ex.: `"danilton": "Damilton"`).

## Testes
`npm test` roda a conferência do cálculo, do parser, da tabela gerada e do fluxo do bot (com Telegram e GitHub simulados).
