
# Secure Media Vault — Full Implementation (Supabase-ready)

This repository is a full implementation of the Secure Media Vault spec (signed uploads, row-scoped access, expiring links).

Highlights of completion:
- Supabase Auth integration (server validates Bearer token via `GET /auth/v1/user`).
- Single-use upload tickets with atomic marking (server-side check+update).
- Magic-bytes sniffing for MIME verification during finalize step.
- Relay-style `myAssets` (AssetConnection with edges + pageInfo).
- Share by email (resolves to user id via `auth.users` lookup).
- UI: gallery grid, drag-and-drop, AbortController cancel, retry, offline finalize queue, copy-link countdown, inline rename with 409 handling, dev-tools flaky network toggle.
- Edge Function `edge/hash-object` for server-side hashing (optional; server has fallback).
- RLS migration SQL and README with setup steps.

Please fill `.env` files in `apps/api`, `apps/web`, and `edge/hash-object` before running.

See `supabase/migrations/001_init.sql` for table schemas and RLS policies (match spec).

Quickstart (local):
1. Install Node 18+ and pnpm.
2. `pnpm install`
3. Create Supabase project, create private bucket named `private` (or set SUPABASE_PRIVATE_BUCKET).
4. Copy `.env.example` -> `.env` in `apps/api`, `apps/web`, `edge/hash-object` and fill values.
5. Apply SQL in `supabase/migrations/001_init.sql` via Supabase SQL editor or CLI.
6. `pnpm --filter apps/api dev` and `pnpm --filter apps/web dev` to start servers.
7. Use the web UI; sign in with Supabase Auth or set demo token/header as described below.

Notes about auth for local dev:
- The API validates `Authorization: Bearer <access_token>` by calling Supabase's `/auth/v1/user` endpoint. Provide a real access token for full Supabase Auth behavior.
- For quick local testing you can still use `x-user-id` header but production should use Bearer tokens.

