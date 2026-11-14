import { expect, test, vi } from 'vitest';
import { buildApp } from './build-app.js';

const entity = '460e73a5-5733-41df-bcd0-f87134395c01';
const id = '460e73a5-5733-41df-bcd0-f87134395c06';
const config = { origin: 'http://localhost:5173', supabase: { url: 'https://supabase.example.test', key: 'publishable-key' } };
const headers = { authorization: 'Bearer owner-token' };

test('all added operational routes reject unauthenticated requests', async () => {
  const app = buildApp(config);
  const base = `/api/v1/entities/${entity}`;
  const requests = [
    { method: 'GET', url: base + '/invoices' }, { method: 'GET', url: base + '/challans' },
    { method: 'GET', url: base + '/invoices/' + id }, { method: 'GET', url: base + '/challans/' + id },
    { method: 'PATCH', url: base + '/invoices/' + id }, { method: 'PATCH', url: base + '/challans/' + id },
    { method: 'DELETE', url: base + '/invoices/' + id }, { method: 'DELETE', url: base + '/challans/' + id },
    { method: 'POST', url: base + '/invoices/' + id + '/duplicate' }, { method: 'POST', url: base + '/invoices/preview' },
    { method: 'GET', url: base + '/dashboard' }, { method: 'GET', url: '/api/v1/analytics/central' },
    { method: 'GET', url: base + '/customers/' + id + '/summary' }, { method: 'GET', url: base + '/payments' },
    { method: 'GET', url: base + '/audit' }, { method: 'GET', url: base + '/templates' },
    { method: 'GET', url: base + '/files' }, { method: 'GET', url: base + '/sequences' },
    { method: 'GET', url: base + '/styles/directory' }, { method: 'GET', url: base + '/styles/' + id },
    { method: 'PATCH', url: base + '/styles/' + id }, { method: 'PATCH', url: base + '/settings' },
    { method: 'GET', url: '/api/v1/workspace' }, { method: 'PATCH', url: '/api/v1/workspace' },
    { method: 'GET', url: '/api/v1/preferences' }, { method: 'GET', url: '/api/v1/auth/session' },
    { method: 'GET', url: '/api/v1/exports' }, { method: 'GET', url: '/api/v1/exports/' + id + '/status' },
    { method: 'POST', url: base + '/archive' }, { method: 'POST', url: base + '/restore' },
  ] as const;
  try {
    for (const request of requests) {
      const response = await app.inject(request);
      expect(response.statusCode, request.method + ' ' + request.url).toBe(401);
      expect(response.headers['cache-control']).toBe('no-store');
    }
  } finally { await app.close(); }
});

test('list endpoint forwards scoped validated filters and rejects invalid periods', async () => {
  const calls: unknown[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    expect(request.headers.get('authorization')).toBe(headers.authorization);
    const path = new URL(request.url).pathname;
    if (path === '/auth/v1/user') return Response.json({ id, email: 'owner@example.test' });
    if (path === '/rest/v1/billing_entities') return Response.json({ id: entity, workspace_id: id });
    expect(path).toBe('/rest/v1/rpc/list_documents');
    calls.push(await request.json());
    return Response.json({ data: [], page: 2, pageSize: 10, total: 0 });
  });
  const app = buildApp(config);
  try {
    const url = `/api/v1/entities/${entity}/invoices`;
    const response = await app.inject({ url: url + '?page=2&pageSize=10&status=issued&overdue=true', headers });
    expect(response.statusCode).toBe(200);
    expect(calls).toEqual([{ p_entity: entity, p_kind: 'invoices', p_filters: { page: 2, pageSize: 10, status: 'issued', overdue: true, sort: 'newest' } }]);
    const invalid = await app.inject({ url: url + '?from=2026-12-01&to=2026-01-01', headers });
    expect(invalid.statusCode).toBe(400);
    expect(calls).toHaveLength(1);
  } finally { vi.unstubAllGlobals(); await app.close(); }
});

test('document detail never retrieves a document through a different company', async () => {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const path = new URL(request.url).pathname;
    if (path === '/auth/v1/user') return Response.json({ id, email: 'owner@example.test' });
    if (path === '/rest/v1/billing_entities') return Response.json({ id: entity, workspace_id: id });
    expect(path).toBe('/rest/v1/rpc/document_detail');
    expect(await request.json()).toEqual({ p_entity: entity, p_kind: 'invoices', p_id: id });
    return Response.json({ code: 'P0002', message: 'Document not found' }, { status: 400 });
  });
  const app = buildApp(config);
  try {
    const response = await app.inject({ url: `/api/v1/entities/${entity}/invoices/${id}`, headers });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ code: 'P0002', error: 'Record not found.' });
  } finally { vi.unstubAllGlobals(); await app.close(); }
});

test('malformed JSON and unknown internal errors have bounded responses', async () => {
  const app = buildApp(config);
  try {
    const response = await app.inject({ method: 'POST', url: `/api/v1/entities/${entity}/invoices`, headers: { ...headers, 'content-type': 'application/json' }, payload: '{' });
    expect(response.statusCode).toBe(400);
    expect(response.json().requestId).toBeTruthy();
    expect(response.body).not.toContain('stack');
  } finally { await app.close(); }
});

test('CORS allows authorized PATCH and DELETE calls with concurrency headers',async()=>{
  const app=buildApp(config);
  try {
    const response=await app.inject({method:'OPTIONS',url:`/api/v1/entities/${entity}/invoices/${id}`,
      headers:{origin:config.origin,'access-control-request-method':'PATCH','access-control-request-headers':'authorization,content-type,if-match'}});
    expect(response.statusCode).toBe(204);
    expect(response.headers['access-control-allow-methods']).toContain('PATCH');
    expect(response.headers['access-control-allow-methods']).toContain('DELETE');
    expect(String(response.headers['access-control-allow-headers']).toLowerCase()).toContain('if-match');
  } finally {await app.close();}
});
