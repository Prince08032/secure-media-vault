import React, { useState, useRef, useEffect } from 'react';

type TileState = 'idle'|'requestingTicket'|'uploading'|'verifying'|'ready'|'corrupt'|'error';

type FileTile = {
  id: string;
  file: File;
  filename: string;
  size: number;
  status: TileState;
  progress: number;
  assetId?: string;
  controller?: AbortController;
  version?: number;
  countdown?: number;
  editing?: boolean;
};

const API = 'https://secure-media-vault-4swc.onrender.com/';

function human(n:number){ return (n/1024).toFixed(2)+' KB'; }

export default function App(){
  const [tiles, setTiles] = useState<FileTile[]>([]);
  const [uid, setUid] = useState('');
  const [devFlaky, setDevFlaky] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(()=>{
    const pend = localStorage.getItem('smv:pending');
    if(pend){
      try{
        const arr = JSON.parse(pend);
        arr.forEach((p:any)=>{ setTimeout(()=>attemptFinalizeFromPending(p), 2000); });
      }catch(e){}
    }
    window.addEventListener('online', onOnline);
    return ()=>window.removeEventListener('online', onOnline);
  },[]);

  function onOnline(){ 
    const pend = localStorage.getItem('smv:pending');
    if(!pend) return;
    const arr = JSON.parse(pend);
    arr.forEach((p:any)=>attemptFinalizeFromPending(p));
    localStorage.removeItem('smv:pending');
  }

  function addPending(p:any){
    const pend = localStorage.getItem('smv:pending');
    const arr = pend ? JSON.parse(pend) : [];
    arr.push(p);
    localStorage.setItem('smv:pending', JSON.stringify(arr));
  }

  async function attemptFinalizeFromPending(p:any){
    try{
      await finalizeFlow(p.tileId, p.assetId, p.file, p.version);
      console.log('finalized from pending', p.assetId);
    }catch(e){ console.warn('pending finalize failed', e); }
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>){
    const f = e.target.files;
    if(!f) return;
    const arr = Array.from(f).map(file=>({ id: crypto.randomUUID(), file, filename: file.name, size: file.size, status:'idle' as TileState, progress:0 }));
    setTiles(t=>[...arr, ...t]);
  }

  async function createTicket(file: File){
    const body = { query: 'mutation Create($fn:String!, $m:String!, $s:Int!){ createUploadUrl(filename:$fn, mime:$m, size:$s){ assetId, uploadUrl, storagePath, expiresAt, nonce } }', variables: { fn: file.name, m: file.type||'application/octet-stream', s: file.size } };
    const headers:any = { 'content-type':'application/json' };
    if(uid) headers['x-user-id'] = uid;
    const resp = await fetch(API, { method:'POST', headers, body: JSON.stringify(body) });
    const json = await resp.json();
    if(json.errors) throw json.errors;
    return json.data.createUploadUrl;
  }

  async function uploadToSignedUrl(uploadUrl: string, file: File, controller: AbortController){
    if(devFlaky && Math.random() < 0.15){ throw new Error('Simulated network failure (dev flaky)'); }
    const resp = await fetch(uploadUrl, { method: 'PUT', body: file, signal: controller.signal });
    if(!resp.ok) throw new Error('Upload failed');
    return true;
  }

  async function finalizeFlow(tileId: string, assetId: string, file: File, version:number){
    const array = await file.arrayBuffer();
    const hashBuf = await crypto.subtle.digest('SHA-256', array);
    const hashHex = Array.from(new Uint8Array(hashBuf)).map(b=>b.toString(16).padStart(2,'0')).join('');
    const headers:any = {'content-type':'application/json'};
    if(uid) headers['x-user-id'] = uid;
    const body = { query: 'mutation Final($id:ID!, $h:String!, $v:Int!){ finalizeUpload(assetId:$id, clientSha256:$h, version:$v){ id, status, sha256, version } }', variables:{ id: assetId, h: hashHex, v: version } };
    const resp = await fetch(API, { method:'POST', headers, body: JSON.stringify(body) });
    const json = await resp.json();
    if(json.errors) throw json.errors;
    return json.data.finalizeUpload;
  }

  async function uploadTile(t:FileTile){
    setTiles(ts=>ts.map(x=>x.id===t.id?{...x, status:'requestingTicket'}:x));
    let ticket;
    try{ ticket = await createTicket(t.file); }catch(e:any){ setTiles(ts=>ts.map(x=>x.id===t.id?{...x, status:'error'}:x)); return; }
    const controller = new AbortController();
    setTiles(ts=>ts.map(x=>x.id===t.id?{...x, status:'uploading', assetId: ticket.assetId, controller, progress:5, version:1}:x));
    try{
      for(let p=10;p<50;p+=10){ await new Promise(r=>setTimeout(r,120)); setTiles(ts=>ts.map(x=>x.id===t.id?{...x, progress:p}:x)); }
      await uploadToSignedUrl(ticket.uploadUrl, t.file, controller);
      setTiles(ts=>ts.map(x=>x.id===t.id?{...x, progress:75, status:'verifying'}:x));
      try{
        const res = await finalizeFlow(t.id, ticket.assetId, t.file, 1);
        setTiles(ts=>ts.map(x=>x.id===t.id?{...x, status: 'ready', progress:100, version: res.version}:x));
  try {
  await finalizeFlow(t.id, ticket.assetId, t.file, 1);
} catch(e: any) {
  console.log(e.message, e.code); 
  // Should log: "NOT_FOUND_OR_USED", "NOT_FOUND_OR_USED"
}

      }catch(e:any){
        if(!navigator.onLine){
          addPending({ tileId: t.id, assetId: ticket.assetId, file: null, version: 1 });
          setTiles(ts=>ts.map(x=>x.id===t.id?{...x, status:'error'}:x));
        } else { setTiles(ts=>ts.map(x=>x.id===t.id?{...x, status:'corrupt'}:x)); }
      }
    }catch(e:any){
       setTiles(ts=>ts.map(x=>x.id===t.id?{...x, status:'error'}:x)); 
      }
  }
  

  function cancelUpload(tileId:string){
    setTiles(ts=>ts.map(x=>{ if(x.id===tileId && x.controller){ x.controller.abort(); return {...x, status:'error'} } return x; }));
  }

  async function retryTile(tileId:string){
    const t = tiles.find(x=>x.id===tileId);
    if(!t) return;
    await uploadTile(t);
  }

  async function copyLink(assetId:string, tileId:string){
    const headers:any = {'content-type':'application/json'};
    if(uid) headers['x-user-id'] = uid;
    const body = { query: 'query GetDL($id:ID!){ getDownloadUrl(assetId:$id){ url, expiresAt } }', variables:{ id: assetId } };
    const resp = await fetch(API, { method:'POST', headers, body: JSON.stringify(body) });
    const json = await resp.json();
    if(json.errors) { alert('Error getting link'); return; }
    const link = json.data.getDownloadUrl;
    navigator.clipboard.writeText(link.url);
    const expiresAt = new Date(link.expiresAt).getTime();
    const update = setInterval(()=>{
      const now = Date.now();
      const left = Math.max(0, Math.ceil((expiresAt - now)/1000));
      setTiles(ts=>ts.map(x=>x.id===tileId?{...x, countdown:left}:x));
      if(now >= expiresAt) clearInterval(update);
    }, 900);
  }

  async function renameTile(tile: FileTile, newName: string) {
    if (!tile.assetId || tile.version === undefined) return;
    const headers: any = { 'content-type': 'application/json' };
    if (uid) headers['x-user-id'] = uid;

    const attemptRename = async (version: number) => {
      const body = {
        query: 'mutation Rename($id:ID!, $filename:String!, $version:Int!){ renameAsset(assetId:$id, filename:$filename, version:$version){ id, filename, version } }',
        variables: { id: tile.assetId, filename: newName, version }
      };
      const resp = await fetch(API, { method: 'POST', headers, body: JSON.stringify(body) });
      const json = await resp.json();
      if (json.errors) throw json.errors;
      return json.data.renameAsset;
    };

    try {
      const result = await attemptRename(tile.version);
      setTiles(ts => ts.map(t => t.id === tile.id ? { ...t, filename: result.filename, version: result.version, editing: false } : t));
    } catch (err: any) {
      if (err[0]?.extensions?.code === 'VERSION_CONFLICT') {
        // fetch latest version
        const fetchBody = {
          query: 'query GetAsset($id:ID!){ myAssets(first:50){ edges{ node{id, filename, version} } } }',
          variables: { id: tile.assetId }
        };
        const resp = await fetch(API, { method: 'POST', headers, body: JSON.stringify(fetchBody) });
        const json = await resp.json();
        const latest = json.data?.myAssets?.edges?.find((e: any) => e.node.id === tile.assetId)?.node;
        if (!latest) { alert('Failed to reconcile version.'); return; }
        setTiles(ts => ts.map(t => t.id === tile.id ? { ...t, version: latest.version, filename: latest.filename } : t));
        await renameTile({ ...tile, version: latest.version, filename: latest.filename }, newName);
      } else { console.error(err); alert('Rename failed'); }
    }
  }
async function simulateHashMismatch(tile: FileTile) {
  if (!tile.assetId || !tile.file) return;
  const fakeHash = '0000000000000000000000000000000000000000000000000000000000000000';
  const headers: any = { 'content-type': 'application/json' };
  if (uid) headers['x-user-id'] = uid;

  const body = {
    query: `
      mutation Final($id:ID!, $h:String!, $v:Int!){
        finalizeUpload(assetId:$id, clientSha256:$h, version:$v){
          id, status, sha256, version
        }
      }`,
    variables: { id: tile.assetId, h: fakeHash, v: tile.version || 1 }
  };

  try {
    const resp = await fetch(API, { method: 'POST', headers, body: JSON.stringify(body) });
    const json = await resp.json();

    if (json.errors) {
      console.log('Hash mismatch demo:', json.errors[0].message, json.errors[0].extensions?.code);
      // Update tile status to corrupt
      setTiles(ts => ts.map(t => t.id === tile.id ? { ...t, status: 'corrupt' } : t));
    } else {
      console.log('Unexpected success:', json.data);
    }
  } catch (e) {
    console.error('Hash mismatch fetch error:', e);
  }
}

  // --- Drag & Drop handlers ---
  function onDrop(e: React.DragEvent<HTMLDivElement>){
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    const arr = files.map(file=>({ id: crypto.randomUUID(), file, filename: file.name, size: file.size, status:'idle' as TileState, progress:0 }));
    setTiles(t=>[...arr, ...t]);
  }
  function onDragOver(e: React.DragEvent<HTMLDivElement>){ e.preventDefault(); }

  return (
    <div style={{padding:20,fontFamily:'system-ui'}}>
      <h1>Secure Media Vault — Demo (Full)</h1>
      <div style={{marginBottom:12}}>
        <label style={{marginRight:8}}>Dev: flaky network</label>
        <input type="checkbox" checked={devFlaky} onChange={e=>setDevFlaky(e.target.checked)} />
        <div style={{marginTop:8}}>
          <input placeholder="x-user-id (demo) or use Authorization bearer token" value={uid} onChange={e=>setUid(e.target.value)} style={{width:400}} />
        </div>
        <div style={{marginTop:8}}>
          <input type="file" multiple ref={fileInputRef} onChange={onPick} />
        </div>
      </div>

      <div 
        onDrop={onDrop} 
        onDragOver={onDragOver} 
        style={{padding:12, border:'2px dashed #aaa', borderRadius:8, marginBottom:12, textAlign:'center', color:'#888'}}
      >
        Drag & drop files here
      </div>

      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,360px)',gap:12}}>
{tiles.map(t=>(
  <div key={t.id} style={{border:'1px solid #ddd',padding:12,borderRadius:8}}>
    {t.editing ? (
      <input 
        value={t.filename} 
        onChange={e=>setTiles(ts=>ts.map(x=>x.id===t.id?{...x, filename:e.target.value}:x))} 
        onBlur={e=>renameTile(t, e.target.value)} 
        onKeyDown={e=>{ if(e.key==='Enter') renameTile(t, t.filename); }} 
        autoFocus 
      />
    ) : (
      <div style={{cursor:'pointer'}} onDoubleClick={()=>setTiles(ts=>ts.map(x=>x.id===t.id?{...x, editing:true}:x))}>
        <div style={{fontWeight:600}}>{t.filename}</div>
        {t.version !== undefined && <div style={{fontSize:11,color:'#666'}}>Version: {t.version}</div>}
      </div>
    )}
    <div style={{fontSize:12}}>{human(t.size)}</div>
    <div style={{height:8,background:'#f0f0f0',borderRadius:4,marginTop:8}}>
      <div style={{width:Math.max(4,t.progress)+'%',height:8,background:'#4caf50',borderRadius:4}}></div>
    </div>
    <div style={{marginTop:8}}><small>Status: {t.status} {t.countdown? `• ${t.countdown}s` : ''}</small></div>
    <div style={{display:'flex',gap:10,marginTop:8}}>
      <button onClick={()=>uploadTile(t)} disabled={t.status!=='idle'}>Upload</button>
      <button onClick={()=>cancelUpload(t.id)} disabled={!t.controller}>Cancel</button>
      <button onClick={()=>retryTile(t.id)}>Retry</button>
      {t.assetId && <button onClick={()=>copyLink(t.assetId, t.id)}>Copy link</button>}
      {t.assetId && <button onClick={()=>simulateHashMismatch(t)}>Corrupt Demo</button>}
    </div>
  </div>
))}

      </div>
    </div>
  );
}


// import React, { useEffect, useRef, useState } from 'react';

// type TileState = 'idle'|'requestingTicket'|'uploading'|'verifying'|'ready'|'corrupt'|'error'|'canceled';

// type FileTile = {
//   id: string;
//   file: File;
//   filename: string;
//   size: number;
//   status: TileState;
//   progress: number;
//   assetId?: string;
//   controller?: AbortController;
//   version?: number;
//   countdown?: number;
// };

// type Asset = {
//   id: string;
//   filename: string;
//   mime: string;
//   size: number;
//   status: string;
//   version: number;
//   storagePath?: string;
//   sha256?: string;
// };

// const API = 'http://localhost:4000/graphql';

// function human(n:number){
//   if(n<1024) return n+' B';
//   return (n/1024).toFixed(1)+' KB';
// }

// export default function App() {
//   const [tiles, setTiles] = useState<FileTile[]>([]);
//   const [assets, setAssets] = useState<Asset[]>([]);
//   const [uid, setUid] = useState('');
//   const [token, setToken] = useState('');
//   const [flaky, setFlaky] = useState(false);
//   const inputRef = useRef<HTMLInputElement|null>(null);
//   const dropRef = useRef<HTMLDivElement|null>(null);

//   // Share modal
//   const [shareOpen, setShareOpen] = useState(false);
//   const [shareAssetId, setShareAssetId] = useState<string|null>(null);
//   const [shareEmail, setShareEmail] = useState('');

//   useEffect(() => {
//     // process pending uploads
//     const pend = localStorage.getItem('smv:pending');
//     if (pend) {
//       try { 
//         const arr = JSON.parse(pend);
//         arr.forEach((p:any) => setTimeout(() => attemptFinalizeFromPending(p), 2000));
//       } catch(e) {}
//     }
//     fetchAssets();
//     window.addEventListener('online', onOnline);
//     return () => window.removeEventListener('online', onOnline);
//   }, []);

//   function onOnline(){
//     flushFinalizeQueue();
//     fetchAssets();
//   }

//   function addFiles(list: FileList | File[]){
//     const arr = Array.from(list).map(f => ({
//       id: crypto.randomUUID(),
//       file: f,
//       filename: f.name,
//       size: f.size,
//       status: 'idle' as TileState,
//       progress: 0,
//       controller: undefined,
//       version: 1
//     }));
//     setTiles(prev => [...arr, ...prev]);
//   }

//   // Drag & drop
//   useEffect(() => {
//     const el = dropRef.current;
//     if (!el) return;
//     const prevent = (e: Event) => { e.preventDefault(); e.stopPropagation(); }
//     const onDrop = (e: any) => { prevent(e); if(e.dataTransfer?.files) addFiles(e.dataTransfer.files); }
//     el.addEventListener('dragover', prevent);
//     el.addEventListener('dragenter', prevent);
//     el.addEventListener('drop', onDrop);
//     return () => {
//       el.removeEventListener('dragover', prevent);
//       el.removeEventListener('dragenter', prevent);
//       el.removeEventListener('drop', onDrop);
//     }
//   }, [dropRef.current]);

// // Unified GraphQL request function
// async function graphqlQuery(body: { query: string; variables?: any }) {
//   const headers: any = { 'Content-Type': 'application/json' };
//   if (token) headers['Authorization'] = 'Bearer ' + token;
//   else if (uid) headers['x-user-id'] = uid;

//   const payload = {
//     query: body.query,
//     variables: body.variables || {}
//   };

//   const res = await fetch(API, {
//     method: 'POST',
//     headers,
//     body: JSON.stringify(payload)
//   });

//   if (!res.ok) {
//     const text = await res.text();
//     throw new Error('GraphQL request failed: ' + text);
//   }

//   return res.json();
// }

// async function fetchAssets() {
//   try {
//     const resp = await graphqlQuery({
//       query: `
//         query {
//           myAssets {
//             edges {
//               node {
//                 id
//                 filename
//                 mime
//                 size
//                 status
//                 version
//                 createdAt
//                 updatedAt
//               }
//             }
//           }
//         }
//       `
//     });

//     if (resp?.data?.myAssets?.edges) {
//       const assets = resp.data.myAssets.edges.map((e: any) => e.node);
//       setAssets(assets);
//     }
//   } catch (e) {
//     console.warn(e);
//   }
// }

//   async function attemptFinalizeFromPending(p:any){
//     try { await finalizeFlow(p.tileId, p.assetId, p.file, p.version); } catch(e){ console.warn(e); }
//   }

//   function addPending(p:any){
//     const pend = localStorage.getItem('smv:pending');
//     const arr = pend ? JSON.parse(pend) : [];
//     arr.push(p);
//     localStorage.setItem('smv:pending', JSON.stringify(arr));
//   }

//   async function finalizeFlow(tileId:string, assetId:string, file:File|null, version:number){
//     if(!file) return;
//     const array = await file.arrayBuffer();
//     const hashBuf = await crypto.subtle.digest('SHA-256', array);
//     const hashHex = Array.from(new Uint8Array(hashBuf)).map(b=>b.toString(16).padStart(2,'0')).join('');
//     const body = {
//       query: 'mutation Final($id:ID!, $h:String!, $v:Int!){ finalizeUpload(assetId:$id, clientSha256:$h, version:$v){ id status sha256 version } }',
//       variables: { id: assetId, h: hashHex, v: version }
//     };
//     const headers:any = {'content-type':'application/json'};
//     if(uid) headers['x-user-id'] = uid;
//     const resp = await fetch(API, { method:'POST', headers, body: JSON.stringify(body) });
//     const json = await resp.json();
//     if(json.errors) throw json.errors;
//     return json.data.finalizeUpload;
//   }

//   // --- Upload logic ---
// async function startUpload(t: FileTile) {
//   setTiles(ts => ts.map(x => x.id === t.id ? { ...x, status: 'requestingTicket' } : x));

//   let ticket;
//   try {
//     const body = {
//       query: `
//         mutation Create($fn: String!, $m: String!, $s: Int!) {
//           createUploadUrl(filename: $fn, mime: $m, size: $s) {
//             assetId
//             uploadUrl
//             storagePath
//             expiresAt
//             nonce
//           }
//         }
//       `,
//       variables: { fn: t.filename, m: t.file.type || 'application/octet-stream', s: t.size }
//     };

//     const headers: any = { 'Content-Type': 'application/json' };
//     if (uid) headers['x-user-id'] = uid;

//     const resp = await fetch(API, { method: 'POST', headers, body: JSON.stringify(body) });
//     const json = await resp.json();
//     if (json.errors) throw json.errors;

//     ticket = json.data.createUploadUrl;
//   } catch (e: any) {
//     setTiles(ts => ts.map(x => x.id === t.id ? { ...x, status: 'error' } : x));
//     return;
//   }

//   const controller = new AbortController();
//   setTiles(ts => ts.map(x => x.id === t.id ? { ...x, status: 'uploading', assetId: ticket.assetId, controller, progress: 5, version: 1 } : x));

//   try {
//     for (let p = 10; p < 50; p += 10) {
//       await new Promise(r => setTimeout(r, 120));
//       setTiles(ts => ts.map(x => x.id === t.id ? { ...x, progress: p } : x));
//     }

//     if (flaky && Math.random() < 0.15) throw new Error('Simulated network failure');

//     await fetch(ticket.uploadUrl, { method: 'PUT', body: t.file, signal: controller.signal });
//     setTiles(ts => ts.map(x => x.id === t.id ? { ...x, progress: 75, status: 'verifying' } : x));

//     const res = await finalizeFlow(t.id, ticket.assetId, t.file, 1);
//     setTiles(ts => ts.map(x => x.id === t.id ? { ...x, status: 'ready', progress: 100, version: res.version } : x));

//     fetchAssets();
//   } catch (e: any) {
//     if (!navigator.onLine) addPending({ tileId: t.id, assetId: ticket.assetId, file: null, version: 1 });
//     setTiles(ts => ts.map(x => x.id === t.id ? { ...x, status: e.name === 'AbortError' ? 'canceled' : 'error' } : x));
//   }
// }


//   function cancelUpload(tileId:string){
//     setTiles(ts=>ts.map(x=>{ if(x.id===tileId && x.controller){ x.controller.abort(); return {...x,status:'canceled'} } return x; }));
//   }

//   function retryUpload(tileId:string){
//     const t = tiles.find(x=>x.id===tileId);
//     if(!t) return;
//     setTiles(ts=>ts.map(x=>x.id===tileId?{...x,status:'idle',progress:0,controller:undefined}:x));
//     startUpload(t);
//   }

//   function enqueueFinalize(item:any){
//     const key = 'smv_finalize_queue';
//     const q = JSON.parse(localStorage.getItem(key)||'[]');
//     q.push({ assetId:item.assetId, fileName:item.filename });
//     localStorage.setItem(key,JSON.stringify(q));
//   }

//   async function flushFinalizeQueue(){
//     const key = 'smv_finalize_queue';
//     const q = JSON.parse(localStorage.getItem(key)||'[]');
//     if(!q.length) return;
//     for(const it of q){ try{ await fetchAssets(); }catch(e){} }
//     localStorage.removeItem(key);
//   }

// async function getDownload(assetId: string) {
//   try {
//     const headers: any = { 'Content-Type': 'application/json' };
//     if (uid) headers['x-user-id'] = uid;
//     else if (token) headers['Authorization'] = 'Bearer ' + token;

//     const body = {
//       query: `
//         query($id: ID!) {
//           getDownloadUrl(assetId: $id) {
//             url
//             expiresAt
//           }
//         }
//       `,
//       variables: { assetId } // note: backend expects assetId
//     };

//     const res = await fetch(API, { method: 'POST', headers, body: JSON.stringify(body) });
//     if (!res.ok) throw new Error('Network response was not ok');

//     const json = await res.json();
//     if (json.errors) throw json.errors;

//     const info = json.data.getDownloadUrl;

//     await navigator.clipboard.writeText(info.url);
//     alert('Signed link copied to clipboard. Expires at: ' + info.expiresAt);
//   } catch (e: any) {
//     console.log(e);
//     alert('Error fetching download link: ' + (e.message || e));
//   }
// }



//   async function openShare(id:string){ setShareAssetId(id); setShareOpen(true); }
// async function doShare() {
//   if (!shareAssetId) return;
//   try {
//     const body = {
//       query: `
//         mutation($assetId: ID!, $toID: ID!, $canDownload: Boolean!, $version: Int!) {
//           shareAsset(assetId: $assetId, toUserId: $toID, canDownload: $canDownload, version: $version) {
//             id
//           }
//         }
//       `,
//       variables: { assetId: shareAssetId, toID: shareEmail, canDownload: true, version: 1 }
//     };

//     const headers: any = { 'Content-Type': 'application/json' };
//     if (uid) headers['x-user-id'] = uid;

//     const resp = await fetch(API, { method: 'POST', headers, body: JSON.stringify(body) });
//     const json = await resp.json();
//     if (json.errors) throw json.errors;

//     alert('Shared (demo)');
//     setShareOpen(false);
//   } catch (e: any) {
//     alert('Share failed: ' + (e.message || e));
//   }
// }


//   function renderThumb(file:File){
//     if(file.type.startsWith('image/')){
//       const url = URL.createObjectURL(file);
//       return <img src={url} style={{width:'100%',height:'100%',objectFit:'cover'}} onLoad={(e:any)=>URL.revokeObjectURL(url)}/>;
//     }
//     return <div style={{padding:12,color:'#9aa4b2'}}>{file.type||'file'}</div>;
//   }

//   function renderAssetThumb(a:any){
//     if(a.mime?.startsWith('image/')) return <div style={{width:'100%',height:'100%',display:'flex',alignItems:'center',justifyContent:'center',color:'#9aa4b2'}}>Image</div>;
//     return <div style={{padding:12,color:'#9aa4b2'}}>File</div>;
//   }

//   return (
//     <div className="app" style={{padding:20,fontFamily:'system-ui'}}>
//       <div className="header" style={{marginBottom:16,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
//         <div className="brand" style={{display:'flex',gap:12,alignItems:'center'}}>
//           <div className="logo" style={{fontWeight:700,fontSize:20}}>SMV</div>
//           <div>
//             <h1 style={{margin:0,fontSize:20}}>Secure Media Vault</h1>
//             <div className="small-muted" style={{fontSize:12,color:'#666'}}>Private media library — uploads with integrity checks & expiring links</div>
//           </div>
//         </div>
//         <div className="controls" style={{display:'flex',gap:8,alignItems:'center'}}>
//           <label style={{display:'flex',alignItems:'center',gap:4}}>
//             <input type="checkbox" checked={flaky} onChange={e=>setFlaky(e.target.checked)} />
//             <span style={{fontSize:12,color:'#666'}}>Dev: flaky network</span>
//           </label>
//           <input placeholder="x-user-id (demo)" value={uid} onChange={e=>setUid(e.target.value)} className="input" style={{width:200}}/>
//           <input placeholder="Authorization Bearer token" value={token} onChange={e=>setToken(e.target.value)} className="input" style={{width:300}}/>
//         </div>
//       </div>

//       <div className="uploader">
//         <div ref={dropRef} className="dropzone" style={{border:'2px dashed #ccc',padding:16,borderRadius:8,marginBottom:16,textAlign:'center'}}>
//           <div style={{fontSize:16,fontWeight:700}}>Drag & drop files here</div>
//           <div className="small-muted" style={{fontSize:12,color:'#666'}}>Supports images and PDFs. Or click to select files.</div>
//           <div style={{marginTop:8}}>
//             <input ref={inputRef} type="file" multiple style={{display:'none'}} onChange={e=>e.target.files&&addFiles(e.target.files)} />
//             <button className="btn" onClick={()=>inputRef.current?.click()}>Add Files</button>
//           </div>
//         </div>

//         <div className="files-grid" style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))',gap:12}}>
//           {tiles.map(f => (
//             <div key={f.id} className="card" style={{border:'1px solid #ddd',borderRadius:8,padding:12,display:'flex',gap:8}}>
//               <div style={{width:100,height:80}} className="thumb">{renderThumb(f.file)}</div>
//               <div style={{flex:1}}>
//                 <div style={{fontWeight:700}}>{f.filename}</div>
//                 <div className="meta" style={{display:'flex',justifyContent:'space-between',alignItems:'center',fontSize:12,color:'#666'}}>
//                   <div>{human(f.size)}</div>
//                   <div className="badge">{f.status}</div>
//                 </div>
//                 <div className="progress" style={{height:6,background:'#f0f0f0',borderRadius:3,marginTop:4}}>
//                   <i style={{display:'block',height:6,width:`${f.progress||0}%`,background:'#4caf50',borderRadius:3}}></i>
//                 </div>
//                 <div className="actions" style={{marginTop:8,display:'flex',gap:4}}>
//                   {f.status==='idle' && <button className="btn" onClick={()=>startUpload(f)}>Upload</button>}
//                   {f.status==='uploading' && <button className="btn ghost" onClick={()=>cancelUpload(f.id)}>Cancel</button>}
//                   {(f.status==='error' || f.status==='canceled') && <button className="btn" onClick={()=>retryUpload(f.id)}>Retry</button>}
//                 </div>
//               </div>
//             </div>
//           ))}
//         </div>

//         <h3 style={{marginTop:20}}>My Library</h3>
//         <div className="files-grid" style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))',gap:12}}>
//           {assets.map(a=>(
//             <div key={a.id} className="card" style={{border:'1px solid #ddd',borderRadius:8,padding:12}}>
//               <div className="thumb" style={{height:100,width:'100%'}}>{renderAssetThumb(a)}</div>
//               <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:4}}>
//                 <div style={{fontWeight:700}}>{a.filename}</div>
//                 <div className="badge">{a.status}</div>
//               </div>
//               <div className="meta" style={{fontSize:12,color:'#666',display:'flex',justifyContent:'space-between'}}>
//                 <div>{a.mime} • {human(a.size)}</div>
//                 <div>v{a.version}</div>
//               </div>
//               <div className="actions" style={{marginTop:4,display:'flex',gap:4}}>
//                 <button className="btn ghost" onClick={()=>getDownload(a.id)}>Copy Link</button>
//                 <button className="btn ghost" onClick={()=>openShare(a.id)}>Share</button>
//               </div>
//             </div>
//           ))}
//         </div>
//       </div>

//       <div className="footer" style={{marginTop:20,fontSize:12,color:'#666'}}>
//         Tip: Use a Supabase Auth token in Authorization for real auth. For quick testing paste any UUID into x-user-id.
//       </div>

//       {shareOpen && <div className="modal" style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.4)',display:'flex',justifyContent:'center',alignItems:'center'}}>
//         <div className="modal-card" style={{background:'#fff',padding:16,borderRadius:8,minWidth:320}}>
//           <h3>Share asset</h3>
//           <div style={{marginTop:8}}>
//             <input className="input full" style={{width:'100%'}} placeholder="Enter toUserId (demo) or user uuid" value={shareEmail} onChange={e=>setShareEmail(e.target.value)} />
//           </div>
//           <div style={{display:'flex',justifyContent:'flex-end',gap:8,marginTop:12}}>
//             <button className="btn ghost" onClick={()=>setShareOpen(false)}>Cancel</button>
//             <button className="btn" onClick={doShare}>Share</button>
//           </div>
//         </div>
//       </div>}
//     </div>
//   );
// }
