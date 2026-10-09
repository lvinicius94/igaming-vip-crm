# VIP Players — CRM de Jogadores VIP

Painel **full-stack de gestão de jogadores VIP** de uma operação de iGaming. Lista e ranqueia os VIPs por **GGR, ticket, atividade e score**, mostra a evolução mensal de **depósitos e GGR**, e dá ao time de retenção as ações operacionais: ativar **cashback / bônus / experiência**, registrar **saque** e **contato**, e abrir conversa no **WhatsApp** (via Digisac / Chatwoot / Evolution).

> ⚠️ **Projeto de portfólio.** Cópia sanitizada de uma ferramenta interna. **Nenhum dado real de jogador** — nomes e números são fictícios e gerados. Scripts operacionais, listas de contatos (PII) e segredos foram removidos.

![next](https://img.shields.io/badge/Next.js-15-black) ![react](https://img.shields.io/badge/React-19-149eca) ![pg](https://img.shields.io/badge/Postgres-pg-336791) ![bq](https://img.shields.io/badge/BigQuery-8.x-4285F4)

---

## ✨ Funcionalidades

- **5 visões** por aba: VIPs **Ativos** (≤60d) · **Inativos** (>60d) · **Novos** · **Google** (signups sem depósito) · **Plataforma**.
- **Ranking ordenável** por GGR, ticket médio, atividade, score, bônus, experiência ou cadastro, com **scores calculados** (GGR / ticket / atividade).
- **Gráficos mensais** (Recharts) de depósitos e GGR do conjunto exibido.
- **Perfil do jogador**: histórico de ações, evolução de scores e preferências (jogos/provedores/time).
- **Ações de retenção**: ativar cashback/bônus/experiência, registrar saque/contato — com escrita no banco e em planilha (Google Sheets).
- **Integrações WhatsApp**: status de atendimento (Digisac), inboxes/conversas (Chatwoot), instâncias (Evolution API).
- **Auth** por cookie com 2 perfis (`admin` / `atendimento`) e **cron jobs** (cache, sincronização de nomes, histórico de score, disparos).

## 🧱 Stack

- **Next.js 15** (App Router) + **React 19** + **TypeScript**
- **PostgreSQL** (`pg`) read-only + **BigQuery** (`@google-cloud/bigquery`) para dados auxiliares
- **Recharts** para os gráficos
- APIs externas: Digisac, Chatwoot, Evolution, Google Sheets
- Deploy em **Vercel** (cron jobs nativos)

## 🚀 Rodando localmente (modo demo)

Com **`DEMO_MODE=true`** (já vem no `.env.example`), um `middleware` intercepta `/api/*` e devolve **VIPs fictícios** — o app abre **direto, populado e sem login**, sem precisar de banco/BigQuery.

```bash
npm install
cp .env.example .env.local      # DEMO_MODE=true já incluso
npm run dev                     # http://localhost:3000  → CRM populado
```

> Sem o modo demo, o login usa `admin / admin@123` ou `atendimento / atendimento@123` (hashes no `.env.example`) e as telas consultam Postgres/BigQuery reais.

## 🏗️ Destaques de arquitetura

- **Camada de cache** de VIPs com snapshot por data (`/api/vip-cache`, `/api/cron/atualizar-cache`) para telas pesadas.
- **Scores** derivados no cliente (GGR/ticket/atividade) com cores por faixa — `calculate*Score` em `page.tsx`.
- **Modo demo isolado**: `src/middleware.ts` + `src/lib/demoData.ts`, no-op em produção (basta não definir a env). Gera dados deterministicamente, sem PII.
- **Integrações desacopladas** em `src/lib/` (`chatwoot.ts`, `evolution.ts`, `cache-mapeamentos.ts`), todas lendo credenciais de env.

## 🔒 Sanitização

- segredos → variáveis de ambiente (ver `.env.example`); IPs/URLs internos trocados por placeholders;
- **scripts operacionais, jobs e listas de contatos (PII) removidos** do recorte público;
- todos os jogadores e métricas são **amostra gerada** (`src/lib/demoData.ts`).
