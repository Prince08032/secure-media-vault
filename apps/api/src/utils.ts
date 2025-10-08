// @ts-nocheck
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

export const SUPABASE_URL = process.env.SUPABASE_URL ;
export const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE ;
export const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY ;
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
