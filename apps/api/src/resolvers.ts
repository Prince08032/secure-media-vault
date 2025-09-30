
import { Resolvers } from '@graphql-tools/utils';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import fetch from 'node-fetch';
import { service, BUCKET, EDGE_HASH_URL, getUserIdFromAuthHeader } from './utils';
import { sniffMime } from './mimeSniff';

const ALLOWED = ['image/jpeg','image/png','image/webp','application/pdf'];

export const resolvers: Resolvers = {
  Query: {
    myAssets: async (_:any, { after, first=50, q }: any, ctx:any) => {
      const userId = await getUserIdFromAuthHeader(ctx.headers);
      // simple connection: return user's own assets (no search for brevity)
      const { data, error } = await service.from('asset').select('*').eq('owner_id', userId).order('created_at', { ascending:false }).limit(first);
      if(error) throw error;
      const edges = (data||[]).map((a:any)=>({ cursor: a.id, node: { id: a.id, filename: a.filename, mime: a.mime, size: a.size, sha256: a.sha256, status: a.status, version: a.version, createdAt: a.created_at, updatedAt: a.updated_at } }));
      return { edges, pageInfo: { endCursor: edges.length? edges[edges.length-1].cursor : null, hasNextPage: false } };
    },
    getDownloadUrl: async (_:any, { assetId }: any, ctx:any) => {
      const userId = await getUserIdFromAuthHeader(ctx.headers);
      const { data: asset } = await service.from('asset').select('*').eq('id', assetId).single();
      if(!asset) throw Object.assign(new Error('NOT_FOUND'), { code:'NOT_FOUND' });
      if(asset.status !== 'ready') throw Object.assign(new Error('FORBIDDEN'), { code:'FORBIDDEN' });
      if(asset.owner_id !== userId){
        const { data: share } = await service.from('asset_share').select('*').eq('asset_id', assetId).eq('to_user', userId).single();
        if(!share) throw Object.assign(new Error('FORBIDDEN'), { code:'FORBIDDEN' });
      }
      // signed url 90s
      const { data: signed, error: signErr } = await service.storage.from(BUCKET).createSignedUrl(asset.storage_path, 90);
      if(signErr) throw signErr;
      await service.from('download_audit').insert({ asset_id: assetId, user_id: userId });
      return { url: signed.signedUrl, expiresAt: new Date(Date.now()+90*1000).toISOString() };
    }
  },
  Mutation: {
    createUploadUrl: async (_:any, { filename, mime, size }: any, ctx:any) => {
      const userId = await getUserIdFromAuthHeader(ctx.headers);
      if(!ALLOWED.includes(mime)) throw Object.assign(new Error('BAD_REQUEST'), { code:'BAD_REQUEST' });
      const id = uuidv4();
      const safe = filename.replace(/\.\.+/g,'').replace(/[^\w. -]/g,'_').trim();
      const storagePath = `private/${userId}/${new Date().getUTCFullYear()}/${String(new Date().getUTCMonth()+1).padStart(2,'0')}/${id}-${safe}`;
      // create asset
      const { data: asset, error: aErr } = await service.from('asset').insert([{ id, owner_id: userId, filename: safe, mime, size, storage_path: storagePath, status: 'uploading' }]).select().single();
      if(aErr) throw aErr;
      // signed upload url valid 2 hours
      const { data: uploadUrlData, error: upErr } = await service.storage.from(BUCKET).createSignedUploadUrl(storagePath);
      if(upErr) throw upErr;
      const nonce = crypto.randomBytes(12).toString('hex');
      const expiresAt = new Date(Date.now() + 2*60*60*1000).toISOString();
      await service.from('upload_ticket').insert([{ asset_id: id, user_id: userId, nonce, mime, size, storage_path: storagePath, expires_at: expiresAt }]);
      return { assetId: id, storagePath, uploadUrl: uploadUrlData.signedUrl || uploadUrlData.signedUrl || uploadUrlData.signedUrl, expiresAt, nonce };
    },

    finalizeUpload: async (_:any, { assetId, clientSha256, version }: any, ctx:any) => {
      const userId = await getUserIdFromAuthHeader(ctx.headers);
      // fetch asset
      const { data: asset } = await service.from('asset').select('*').eq('id', assetId).single();
      if(!asset) throw Object.assign(new Error('NOT_FOUND'), { code:'NOT_FOUND' });
      if(asset.owner_id !== userId) throw Object.assign(new Error('FORBIDDEN'), { code:'FORBIDDEN' });
      if(asset.version !== version) throw Object.assign(new Error('VERSION_CONFLICT'), { code:'VERSION_CONFLICT' });
      // atomically mark ticket used and fetch ticket
      const ticketUpdate = await service.from('upload_ticket').update({ used: true }).match({ asset_id: assetId, used: false }).select().maybeSingle();
      if(ticketUpdate.error) throw ticketUpdate.error;
      const ticket = ticketUpdate.data;
      if(!ticket) throw Object.assign(new Error('NOT_FOUND_OR_USED'), { code:'NOT_FOUND' });
      // download file and compute hash and sniff
      const { data: dl, error: dlErr } = await service.storage.from(BUCKET).download(ticket.storage_path);
      if(dlErr) {
        // mark corrupt and used
        await service.from('asset').update({ status: 'corrupt', updated_at: new Date().toISOString() }).eq('id', assetId);
        throw Object.assign(new Error('NOT_FOUND_ON_STORAGE'), { code:'NOT_FOUND' });
      }
      const buffer = await dl.arrayBuffer();
      const serverHash = crypto.createHash('sha256').update(Buffer.from(buffer)).digest('hex');
      // sniff MIME
      const sniff = sniffMime(buffer.slice(0, 128));
      if(!sniff || sniff !== ticket.mime){
        await service.from('asset').update({ status: 'corrupt', sha256: serverHash, updated_at: new Date().toISOString() }).eq('id', assetId);
        throw Object.assign(new Error('BAD_REQUEST: MIME_MISMATCH'), { code:'BAD_REQUEST' });
      }
      if(serverHash !== clientSha256){
        await service.from('asset').update({ status: 'corrupt', sha256: serverHash, updated_at: new Date().toISOString() }).eq('id', assetId);
        throw Object.assign(new Error('INTEGRITY_ERROR'), { code:'INTEGRITY_ERROR' });
      }
      // success: mark ready and bump version
      const { data: updated } = await service.from('asset').update({ status: 'ready', sha256: serverHash, version: asset.version + 1, updated_at: new Date().toISOString() }).eq('id', assetId).select().single();
      return { id: updated.id, filename: updated.filename, mime: updated.mime, size: updated.size, sha256: updated.sha256, status: updated.status, version: updated.version, createdAt: updated.created_at, updatedAt: updated.updated_at };
    },

    renameAsset: async (_:any, { assetId, filename, version }: any, ctx:any) => {
      const userId = await getUserIdFromAuthHeader(ctx.headers);
      const safe = filename.replace(/\.\.+/g,'').replace(/[^\w. -]/g,'_').trim();
      const { data: asset } = await service.from('asset').select('*').eq('id', assetId).single();
      if(!asset) throw Object.assign(new Error('NOT_FOUND'), { code:'NOT_FOUND' });
      if(asset.owner_id !== userId) throw Object.assign(new Error('FORBIDDEN'), { code:'FORBIDDEN' });
      if(asset.version !== version) throw Object.assign(new Error('VERSION_CONFLICT'), { code:'VERSION_CONFLICT' });
      const { data: updated } = await service.from('asset').update({ filename: safe, version: asset.version + 1, updated_at: new Date().toISOString() }).eq('id', assetId).select().single();
      return { id: updated.id, filename: updated.filename, mime: updated.mime, size: updated.size, sha256: updated.sha256, status: updated.status, version: updated.version, createdAt: updated.created_at, updatedAt: updated.updated_at };
    },

    shareAsset: async (_:any, { assetId, toEmail, canDownload, version }: any, ctx:any) => {
      const userId = await getUserIdFromAuthHeader(ctx.headers);
      const { data: asset } = await service.from('asset').select('*').eq('id', assetId).single();
      if(!asset) throw Object.assign(new Error('NOT_FOUND'), { code:'NOT_FOUND' });
      if(asset.owner_id !== userId) throw Object.assign(new Error('FORBIDDEN'), { code:'FORBIDDEN' });
      if(asset.version !== version) throw Object.assign(new Error('VERSION_CONFLICT'), { code:'VERSION_CONFLICT' });
      // find user by email
      const { data: users } = await service.auth.admin.listUsers ? await service.auth.admin.listUsers({ query: toEmail }) : { data: [] };
      let toUserId = null;
      if(users && users.length) toUserId = users[0].id;
      else {
        // try lookup in auth.users via SQL
        const { data: u } = await service.from('users_lookup').select('id').eq('email', toEmail).limit(1);
        if(u && u.length) toUserId = u[0].id;
      }
      if(!toUserId) throw Object.assign(new Error('NOT_FOUND:USER'), { code:'NOT_FOUND' });
      await service.from('asset_share').upsert({ asset_id: assetId, to_user: toUserId, can_download: canDownload });
      const { data: updated } = await service.from('asset').update({ version: asset.version + 1, updated_at: new Date().toISOString() }).eq('id', assetId).select().single();
      return { id: updated.id, filename: updated.filename, mime: updated.mime, size: updated.size, sha256: updated.sha256, status: updated.status, version: updated.version, createdAt: updated.created_at, updatedAt: updated.updated_at };
    },

    revokeShare: async (_:any, { assetId, toEmail, version }: any, ctx:any) => {
      const userId = await getUserIdFromAuthHeader(ctx.headers);
      const { data: asset } = await service.from('asset').select('*').eq('id', assetId).single();
      if(!asset) throw Object.assign(new Error('NOT_FOUND'), { code:'NOT_FOUND' });
      if(asset.owner_id !== userId) throw Object.assign(new Error('FORBIDDEN'), { code:'FORBIDDEN' });
      if(asset.version !== version) throw Object.assign(new Error('VERSION_CONFLICT'), { code:'VERSION_CONFLICT' });
      // resolve user id by email - simple SQL lookup
      const { data: u } = await service.from('users_lookup').select('id').eq('email', toEmail).limit(1);
      if(!u || !u.length) throw Object.assign(new Error('NOT_FOUND:USER'), { code:'NOT_FOUND' });
      const toUserId = u[0].id;
      await service.from('asset_share').delete().eq('asset_id', assetId).eq('to_user', toUserId);
      const { data: updated } = await service.from('asset').update({ version: asset.version + 1, updated_at: new Date().toISOString() }).eq('id', assetId).select().single();
      return { id: updated.id, filename: updated.filename, mime: updated.mime, size: updated.size, sha256: updated.sha256, status: updated.status, version: updated.version, createdAt: updated.created_at, updatedAt: updated.updated_at };
    },

    deleteAsset: async (_:any, { assetId, version }: any, ctx:any) => {
      const userId = await getUserIdFromAuthHeader(ctx.headers);
      const { data: asset } = await service.from('asset').select('*').eq('id', assetId).single();
      if(!asset) throw Object.assign(new Error('NOT_FOUND'), { code:'NOT_FOUND' });
      if(asset.owner_id !== userId) throw Object.assign(new Error('FORBIDDEN'), { code:'FORBIDDEN' });
      if(asset.version !== version) throw Object.assign(new Error('VERSION_CONFLICT'), { code:'VERSION_CONFLICT' });
      await service.storage.from(BUCKET).remove([asset.storage_path]);
      await service.from('asset').delete().eq('id', assetId);
      return true;
    }
  }
};
