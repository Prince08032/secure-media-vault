
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import crypto from 'crypto';
dotenv.config();
const supabase = createClient(process.env.SUPABASE_URL || '', process.env.SUPABASE_SERVICE_ROLE || '');

export default async function handler(req:any, res:any){
  try{
    const { path } = req.body || {};
    if(!path) return res.status(400).json({ error: 'missing path' });
    const { data, error } = await supabase.storage.from(process.env.SUPABASE_PRIVATE_BUCKET || 'private').download(path);
    if(error) return res.status(500).json({ error: error.message });
    const buffer = await data.arrayBuffer();
    const sha = crypto.createHash('sha256').update(Buffer.from(buffer)).digest('hex');
    return res.json({ sha256: sha, size: buffer.byteLength });
  }catch(e:any){
    return res.status(500).json({ error: e.message });
  }
}
