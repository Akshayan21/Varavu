import { expect, test, vi } from 'vitest';
import { buildApp } from './build-app.js';

test('reports API health to the web origin', async () => {
  const origin = 'http://localhost:5173';
  const app = buildApp({ origin });
  try {
    const response = await app.inject({ url: '/api/v1/health', headers: { origin } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
    expect(response.headers['access-control-allow-origin']).toBe(origin);
  } finally {
    await app.close();
  }
});

test('rejects workspace initialization without a bearer token', async () => {
  const app = buildApp({ origin: 'http://localhost:5173' });
  try {
    const response = await app.inject({ method: 'POST', url: '/api/v1/workspace/initialize' });
    expect(response.statusCode).toBe(401);
    expect(response.headers['cache-control']).toBe('no-store');
  } finally {
    await app.close();
  }
});


test('verifies the caller and initializes only through their Supabase session', async () => {
  const url = "https://supabase.example.test";
  const user = { id: '77ffb743-825a-4aa8-909f-914c3cdbe008', email: 'owner@example.com' };
  const workspace = { id: 'b44e5b86-7d03-4a7a-83b9-9dba8d351dbd', name: 'Billing Workspace' };
  const authorization = 'Bearer owner-token';
  let workspaceCalls = 0;

  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const path = new URL(request.url).pathname;
    if (path === '/auth/v1/user') {
      return request.headers.get('authorization') === authorization
        ? Response.json(user)
        : Response.json({ message: 'Invalid token' }, { status: 401 });
    }
    expect(path).toBe('/rest/v1/rpc/initialize_workspace');
    expect(request.headers.get('authorization')).toBe(authorization);
    expect(await request.json()).toEqual({});
    workspaceCalls += 1;
    return Response.json(workspace);
  });
  const app = buildApp({ origin: 'http://localhost:5173', supabase: { url, key: 'publishable-key' } });
  const endpoint = { method: 'POST', url: '/api/v1/workspace/initialize' } as const;
  try {
    const rejected = await app.inject({ ...endpoint, headers: { authorization: 'Bearer invalid' } });
    expect(rejected.statusCode).toBe(401);
    expect(workspaceCalls).toBe(0);

    const verified = await app.inject({ ...endpoint, headers: { authorization } });
    expect(verified.statusCode).toBe(200);
    expect(verified.json()).toEqual({ user, workspace });
    expect(workspaceCalls).toBe(1);
  } finally {
    vi.unstubAllGlobals();
    await app.close();
  }
});



test('creates and edits every customer field through authenticated API requests', async () => {
  const ownerId = '77ffb743-825a-4aa8-909f-914c3cdbe008';
  const entityId = '460e73a5-5733-41df-bcd0-f87134395c01';
  const id = '460e73a5-5733-41df-bcd0-f87134395c03';
  let stored: Record<string, unknown> = {};
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    expect(request.headers.get('authorization')).toBe('Bearer owner-token');
    const path = new URL(request.url).pathname;
    if (path === '/auth/v1/user') return Response.json({ id: ownerId, email: 'owner@example.com' });
    if (path === '/rest/v1/workspaces') return Response.json({ id: ownerId });
    if (path === '/rest/v1/billing_entities') return Response.json({ id: entityId });
    expect(path).toBe('/rest/v1/customers');
    if (request.method === 'POST' || request.method === 'PATCH') stored = { ...stored, ...await request.json(), id };
    return Response.json(stored, { status: request.method === 'POST' ? 201 : 200 });
  });
  const app = buildApp({ origin: 'http://localhost:5173', supabase: { url: 'https://supabase.example.test', key: 'publishable-key' } });
  const base = '/api/v1/entities/' + entityId + '/customers';
  const headers = { authorization: 'Bearer owner-token' };
  const payload = { legal_name: 'Test customer', email: 'customer@example.com', phone: '9876543210',
    billing_address: { line1: '12 Test Street' }, gstin: '33ABCDE1234F1Z5', contact_name: 'Contact Person', contact_phone: '9876543211' };
  try {
    const created = await app.inject({ method: 'POST', url: base, headers, payload });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject(payload);
    const edited = await app.inject({ method: 'PATCH', url: base + '/' + id, headers,
      payload: { ...payload, legal_name: 'Updated customer', email: null, gstin: null, contact_phone: '9876543212' } });
    expect(edited.statusCode).toBe(200);
    expect(edited.json()).toMatchObject({ ...payload, legal_name: 'Updated customer', email: null, gstin: null, contact_phone: '9876543212' });
    const loaded = await app.inject({ url: base + '/' + id, headers });
    expect(loaded.statusCode).toBe(200);
    expect(loaded.json()).toEqual(edited.json());
    expect((await app.inject({ method: 'POST', url: base, payload })).statusCode).toBe(401);
  } finally {
    await app.close();
    vi.unstubAllGlobals();
  }
});
