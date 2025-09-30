
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();
export const SUPABASE_URL = process.env.SUPABASE_URL || "https://silezfkplusyvrtggbwk.supabase.co";
export const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNpbGV6ZmtwbHVzeXZydGdnYndrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODcxNjk2NywiZXhwIjoyMDc0MjkyOTY3fQ.Kj7Dnj3tpfBTSp0mqE0Xsno9le9ylmeA6m2Gkd7fW2w";
export const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNpbGV6ZmtwbHVzeXZydGdnYndrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg3MTY5NjcsImV4cCI6MjA3NDI5Mjk2N30.6EMVG99KoCB29YjiIPNPcoMVfRqh504k3buvIYauuXc";
export const BUCKET = process.env.SUPABASE_PRIVATE_BUCKET || 'private';
export const EDGE_HASH_URL = process.env.EDGE_HASH_URL || '';

export const service = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, { auth: { persistSession:false } });

import fetch from 'node-fetch';
// validate bearer token by calling /auth/v1/user
export async function getUserIdFromAuthHeader(headers: any): Promise<string>{
  const auth = headers.get ? headers.get('authorization') : headers['authorization'] || headers['Authorization'];
  if(!auth) {
    // fall back to x-user-id for local dev
    const alt = headers.get ? headers.get('x-user-id') : headers['x-user-id'] || headers['X-User-Id'];
    if(alt) return alt;
    throw Object.assign(new Error('UNAUTHENTICATED'), { code: 'UNAUTHENTICATED' });
  }
  const token = auth.split(' ')[1];
  if(!token) throw Object.assign(new Error('UNAUTHENTICATED'), { code: 'UNAUTHENTICATED' });
  const resp = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { 'Authorization': 'Bearer ' + token } });
  if(!resp.ok) throw Object.assign(new Error('UNAUTHENTICATED'), { code: 'UNAUTHENTICATED' });
  const json = await resp.json();
  if(!json || !json.id) throw Object.assign(new Error('UNAUTHENTICATED'), { code: 'UNAUTHENTICATED' });
  return json.id;
}
