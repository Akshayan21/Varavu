import { expect, test, vi } from 'vitest';
import { buildApp } from './app.js';

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


