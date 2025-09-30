# Secure Media Vault — Full Implementation (Supabase-ready)

This repository implements the Secure Media Vault spec: signed uploads, row-scoped access, expiring links, single-use upload tickets and MIME sniffing.

---

## Quickstart (local)

1. Install Node 18+ and pnpm.
2. `pnpm install`
3. Create Supabase project and a **private** storage bucket named `private`
4. Copy `.env` -> `.env` in these locations and fill values:
   - `secure-media-vault/apps/api/.env` -> `secure-media-vault/apps/api/.env`
   - `secure-media-vault/apps/web/.env` -> `secure-media-vault/apps/web/.env`
   - `secure-media-vault/edge/hash-object/.env` -> `secure-media-vault/edge/hash-object/.env`
5. Apply SQL in `supabase/migrations/001_init.sql` using Supabase SQL editor or CLI.
6. Get user uuid by creating a user in Supabase.This will be used to authenticate user.
6. Start servers:
   - `pnpm dev`

### Required environment variables
- `SUPABASE_URL` - your Supabase instance URL
- `SUPABASE_SERVICE_ROLE` - **service_role** key (must not be committed to repo)
- `SUPABASE_ANON_KEY` - anon/public key
- `SUPABASE_PRIVATE_BUCKET` - name of private bucket (default: `private`)
- `VITE_GRAPHQL_URL` (client) - e.g. `http://localhost:4000/graphql`
- `VITE_USER_ID` - UUID 
- `EDGE_HASH_URL` (optional) - deploy `edge/hash-object` and set this to call it from API (optional)

## 🔑 Supabase Keys & User UUID Setup  

Follow these steps to obtain the required keys for configuration:  

### 1. Supabase URL  
- Go to your [Supabase Dashboard](https://app.supabase.com/).  
- Open your project.  
- Navigate to **Project Settings → API**.  
- Copy the **Project URL** → this is your **Supabase URL**.  

---

### 2. Anon Key  
- In **Project Settings → API**, scroll to **Project API keys**.  
- Copy the **anon public key**.  
- ✅ Safe to use in the **frontend**.  

---

### 3. Service Role Key  
- In **Project Settings → API**, under **Project API keys**, copy the **service_role secret key**.  
- ⚠️ Use this only in the **backend/server**.  
- ❌ Never expose this key in client-side code.  

---

### 4. User UUID  
- Go to **Authentication → Users** in the Supabase dashboard.  
- Click **Add User** and create a new user (email/password or magic link).  
- After creating, open the **Users table** → you will see a column named **ID**.  
- This **ID** is the **User UUID**.  


**Security note:** Ensure `SUPABASE_SERVICE_ROLE` is provided only via environment variables (CI secret or server environment). Do **not** commit service role keys into source control.

---

## Threat Model (required)
This project protects private binary objects stored in a Supabase private bucket. Threats considered and mitigations:

1. **Unauthorized read (stolen access token / public links)**
   - Mitigation: short-lived signed URLs (90s). Server validates whether requester is owner or has explicit share.

2. **Upload tampering / integrity bypass**
   - Mitigation: two-step upload with single-use upload ticket. Server computes SHA-256 of stored object and compares with client-provided `clientSha256`. If mismatch, asset is marked `corrupt`.

3. **Replay of ticket / double-use**
   - Mitigation: upload tickets are marked used atomically during `finalizeUpload`. Subsequent attempts fail.

4. **Path traversal / storage path confusion**
   - Mitigation: filenames sanitized (`..` removed, unsafe chars replaced). Storage path includes a random UUID and owner id. Additional recommendation: apply Unicode normalization and disallow control characters.

5. **Information leakage via share or download links**
   - Mitigation: shares map to user IDs and are row-scoped; download links are ephemeral. Logging is recorded to `download_audit` for investigation.


---

## Trade-offs
- **Edge hashing vs server hashing**
  - Edge function reduces load on API (compute & memory) and can be deployed closer to storage. Server-side hashing removes need to deploy the edge function and simplifies local dev. This repo provides both: server computes by default; `EDGE_HASH_URL` is available for optional use.
- **Signed URL TTL**
  - Short TTL (90s) limits exposure but requires clients to complete downloads quickly. Suitable for direct downloads; longer TTLs increase risk if leaked.
- **Two-step upload**
  - Adds complexity but gives atomic integrity checks and single-use ticket guarantees.

---

## Tests
There are Jest tests under `apps/api/src/__tests__/`. Two acceptance tests were added:
1. Version conflict test (ensures resolver rejects stale versions).
2. Hash/integrity test (ensures corrupt uploads are handled).

Run tests:
```bash
pnpm test
```

---

## Demo
Add your demo video link here after recording the acceptance checks (8 checks mentioned in the spec):
- Demo video: **(paste link here)**

---

## Migrations
Apply `supabase/migrations/001_init.sql` in your Supabase project. That SQL creates `asset`, `upload_ticket`, `asset_share`, `download_audit`, and RLS policies.

---


