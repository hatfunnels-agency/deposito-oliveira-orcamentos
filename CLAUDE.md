# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Stack

Next.js 14 (App Router) + React 18 + TypeScript (strict) + Tailwind. Backend = Supabase (Postgres) accessed exclusively from API routes via service role key. Path alias `@/*` → `./src/*`. Language across UI, comments, and DB columns is **Portuguese (pt-BR)** — preserve it when editing.

## Commands

- `npm run dev` — local dev server (port 3000)
- `npm run build` — production build (Next.js compiles all routes)
- `npm run start` — run the production build
- `npm run lint` — `next lint`
- No test suite is set up. There is no typecheck script — `npm run build` is what catches TS errors. Several recent commits (`fix(ferragens): ... TS build error`, `fix(OrcamentoApp): remove caracteres invalidos`) were build-breaks caught only at deploy time, so run `npm run build` before claiming a change is done.

## Architecture

### Two Supabase clients — pick the right one
- `src/lib/supabase.ts` exports `supabaseAdmin` using `SUPABASE_SERVICE_ROLE_KEY`. **Server-only.** All API routes use this and bypass RLS.
- `src/lib/supabase-client.ts` exports `supabaseBrowser` using the anon key. **Browser-only**, used for auth (`signInWithPassword`, `getSession`).
Never import `supabaseAdmin` from a `'use client'` component.

### Auth flow
- `src/middleware.ts` redirects unauthenticated requests to `/login` by parsing the Supabase auth cookie (`sb-vfdoaocrafbcktnkhyvo-auth-token`) directly. The cookie name is **hard-coded to the project ref** — if Supabase project changes, update the middleware.
- All `/api/*` routes are **explicitly skipped by middleware** (they authorize via service role key, not user session). Don't add user-auth checks to API routes unless intentionally introducing per-user authorization.

### The monolith component
`src/components/OrcamentoApp.tsx` is ~3500 lines and holds the entire app: 8 tabs (`produtos`, `orcamento`, `historico`, `ferragens`, `entregas`, `estoque`, `ia`, `dashboard`), all forms, modals, and ~100 `useState` hooks. New features are typically added inside it rather than extracted. Only `DashboardTab` and `CalculadoraFerroModal` have been split out. When working here, locate state by searching the variable name; don't try to read top-to-bottom.

### Data model (key Supabase tables)
- `clientes` — upserted by `telefone` (unique). Cleaned phone (digits only) is the conflict key.
- `produtos` — `unidade` (storage) vs `unidade_venda` (sale unit) with `fator_conversao` between them. `estoque_atual` is in storage units. **`estoque_compartilhado_com`** points a secondary product to a principal: when reading or writing stock, always resolve to the principal (see `resolverIdPrincipal` in `src/app/api/orcamentos/[id]/route.ts` and `resolverProdutoPrincipal` in `src/app/api/estoque/route.ts`).
- `orcamentos` — codes generated as `ORD-XXXXXXX` via `gerarCodigoOrcamento()` with up to 3 collision retries. Status enum and labels live in `src/lib/supabase.ts` (`OrcamentoStatus`, `STATUS_LABELS`, `STATUS_COLORS`).
- `orcamento_itens` — stores a **`preco_custo` snapshot** at sale time ("Opção B"): the dashboard CMV uses this snapshot, falling back to the current product cost only if the snapshot is 0. Don't strip this snapshot logic.
- `levas_entrega` — delivery batches; `orcamentos.leva_id` joins them.
- `movimentacoes_estoque` — append-only audit log; every stock change inserts a row alongside the `produtos.estoque_atual` update.
- `bling_tokens` — single-row table (key `'refresh_token'`) for the persisted Bling OAuth refresh token.

### Stock side effects on PATCH
`PATCH /api/orcamentos/[id]` triggers stock movements based on status transitions:
- → `entrega_pendente` or `retirada_pendente`: deduct stock (`movimentacoes_estoque.tipo='saida'`).
- → `cancelado` (when `body._previous_status` was a confirmed status): return stock (`tipo='cancelamento'`).
The client must send `_previous_status` for cancellation refunds to work. Quantities are multiplied by `fator_conversao` and applied to the **principal** product.

### Bling ERP integration (OAuth2 v3)
`src/lib/bling-auth.ts` is the only place that talks OAuth. Notable quirks:
- OAuth token endpoint is `www.bling.com.br/Api/v3/oauth/token`; API base is `api.bling.com.br/Api/v3` (different hosts).
- Refresh token is read from Supabase `bling_tokens` first, then `BLING_REFRESH_TOKEN` env. New refresh tokens returned on refresh are auto-persisted back to Supabase.
- `blingFetch()` retries once on 401 by clearing the in-memory access-token cache and refreshing.
- Auth flow: `/api/bling/auth` → Bling consent → `/api/bling/callback` exchanges the code and stores the refresh token. After this, no redeploy is needed to update tokens.

### External integrations (non-blocking)
After creating/updating an orçamento, the route fires `POST /api/ghl/sync` **without `await`** — failures are logged but never block the response. GHL custom-field IDs and pipeline stages are hard-coded constants at the top of `src/app/api/ghl/sync/route.ts`.

### Address & freight
- `/api/endereco` proxies Google Places (autocomplete + details) and Geocoding. `strictbounds` was intentionally removed (commit d1b2d37) so neighboring cities like Cotia/Osasco/Barueri appear in suggestions — don't re-add it.
- `/api/frete` calculates shipping via Google Distance Matrix from the depot origin (`-23.5376,-46.8375`). The pricing table and `DISTANCIA_MAXIMA_KM` (currently 30km) live at the top of the file — edit there, not in the UI.

### AI assistant tab
`/api/ai/chat` aggregates last 30 days of orçamentos + full product/client lists into a context block, then calls Anthropic's API directly (model `claude-sonnet-4-5`, no SDK). Predefined `tipo` values (`resumo_dia`, `relatorio_semanal`, `analise_clientes`, `previsao_estoque`) replace the user prompt with a templated one.

## Required environment variables

See `.env.example`. The non-obvious ones:
- `SUPABASE_SERVICE_ROLE_KEY` — server-only, bypasses RLS, never expose to client.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — required by `supabase-client.ts` even though `.env.example` only lists the URL.
- `GOOGLE_MAPS_API_KEY` — needs Distance Matrix + Geocoding + Places enabled in Google Cloud Console; missing it returns 503 from `/api/endereco` (autocomplete) and 500 from `/api/frete`.
- `ANTHROPIC_API_KEY` — required by `/api/ai/chat`.
- `GHL_*` — GoHighLevel sync variables; sync is non-blocking, so missing values just disable the sync silently.
- `BLING_CLIENT_ID` / `BLING_CLIENT_SECRET` — Bling OAuth app credentials; `BLING_REFRESH_TOKEN` is only a fallback once Supabase has the persisted token.

## Code conventions worth knowing

- Indentation in this repo is wildly inconsistent (mix of 2/4/6/8 spaces, sometimes within the same function). Match the surrounding style of the function you're editing rather than reformatting.
- Commit messages follow Conventional Commits in pt-BR: `feat(scope):`, `fix(scope):`, scopes seen include `OrcamentoApp`, `ferragens`, `dashboard`, `endereco`, `messages`, `desconto`.
- API routes that read/write live data set `export const dynamic = 'force-dynamic'` to opt out of Next caching — keep it when adding new dynamic routes.
