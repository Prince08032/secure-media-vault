// __tests__/minimal.test.ts



jest.mock('../utils', () => ({
  service: {
    from: () => ({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      delete: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: { id: 'fake-id', version: 1 } }),
    }),
    storage: {
      from: () => ({
        createSignedUrl: jest.fn().mockResolvedValue({ data: { signedUrl: 'http://fake-url' } }),
        download: jest.fn().mockResolvedValue({ arrayBuffer: async () => new ArrayBuffer(8) }),
        remove: jest.fn().mockResolvedValue({}),
      }),
    },
  },
  BUCKET: 'test-bucket',
  getUserIdFromAuthHeader: jest.fn().mockResolvedValue('test-user'),
}));

import fetch from 'node-fetch';
const API =  'http://localhost:4000/graphql';

const headers = { 'content-type': 'application/json', 'x-user-id': 'demo-user' };

describe('Minimal backend tests', () => {
  
  let assetId: string;
  
  test('Version conflict test', async () => {
    // Step 1: create an upload ticket
    const createResp = await fetch(API, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        query: `
          mutation Create($fn:String!, $m:String!, $s:Int!){
            createUploadUrl(filename:$fn, mime:$m, size:$s){
              assetId, uploadUrl
            }
          }`,
        variables: { fn: 'test.txt', m: 'text/plain', s: 10 }
      })
    });
    const createJson = await createResp.json();
    assetId = createJson.data.createUploadUrl.assetId;

    // Step 2: finalize normally (version = 1)
    const array = new TextEncoder().encode('Hello'); // fake file content
    const hashBuffer = await crypto.subtle.digest('SHA-256', array);
    const hashHex = Array.from(new Uint8Array(hashBuffer)).map(b=>b.toString(16).padStart(2,'0')).join('');

    await fetch(API, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        query: `
          mutation Final($id:ID!, $h:String!, $v:Int!){
            finalizeUpload(assetId:$id, clientSha256:$h, version:$v){
              id, status, version
            }
          }`,
        variables: { id: assetId, h: hashHex, v: 1 }
      })
    });

    // Step 3: try finalize again with stale version
    const conflictResp = await fetch(API, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        query: `
          mutation Final($id:ID!, $h:String!, $v:Int!){
            finalizeUpload(assetId:$id, clientSha256:$h, version:$v){
              id, status, version
            }
          }`,
        variables: { id: assetId, h: hashHex, v: 1 } // old version
      })
    });
    const conflictJson = await conflictResp.json();
    expect(conflictJson.errors[0].extensions.code).toBe('VERSION_CONFLICT');
  });

  test('Hash/integrity test', async () => {
    // Use a fake hash
    const fakeHash = '0000000000000000000000000000000000000000000000000000000000000000';

    const resp = await fetch(API, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        query: `
          mutation Final($id:ID!, $h:String!, $v:Int!){
            finalizeUpload(assetId:$id, clientSha256:$h, version:$v){
              id, status, version
            }
          }`,
        variables: { id: assetId, h: fakeHash, v: 2 }
      })
    });
    const json = await resp.json();
    expect(json.errors[0].extensions.code).toBe('INTEGRITY_ERROR');
  });

});
