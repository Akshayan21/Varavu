import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { buildApp } from './build-app.js';

test('published API reference covers every registered application route', async () => {
  const manifest = JSON.parse(readFileSync('docs/api/endpoint-manifest.json', 'utf8')) as {
    registeredRouteCount: number; endpoints: { method: string; path: string; response: string | null }[];
  };
  const examples = JSON.parse(readFileSync('docs/api/response-examples.json', 'utf8')) as Record<string, unknown>;
  const canonical = (path: string) => path.replace(/\{[^}]+\}|:[^/]+/g, ':param');
  const routes: { method: string; path: string }[] = [];
  const app = buildApp({ origin: 'http://localhost:5173', onRoute(options) {
    for (const method of Array.isArray(options.method) ? options.method : [options.method]) {
      if (!['HEAD', 'OPTIONS'].includes(method)) routes.push({ method, path: options.url });
    }
  } });
  try {
    await app.ready();
    expect(routes).toHaveLength(manifest.registeredRouteCount);
    for (const route of routes) {
      const documented = manifest.endpoints.some(endpoint => endpoint.method === route.method && (
        canonical(endpoint.path) === canonical(route.path)
        || route.path.endsWith('/:kind/:id/pdf') && /\/(invoices|challans)\/\{id\}\/pdf$/.test(endpoint.path)
        || route.path.startsWith('/api/v1/reports/:type') && endpoint.path.startsWith('/api/v1/reports/')
      ));
      expect(documented, route.method + ' ' + route.path).toBe(true);
    }
    for (const endpoint of manifest.endpoints) {
      if (endpoint.response && !['PDF','EXPORT'].includes(endpoint.response)) {
        expect(examples[endpoint.response], endpoint.response).toBeDefined();
      }
    }
    expect(examples.EntityArchived).toMatchObject({ is_active: false });
    expect(examples.EntityRestored).toMatchObject({ is_active: true });
    expect(examples.InvoiceIssued).toMatchObject({ status: 'Issued', totalCents: 131250 });
    expect(examples.InvoiceCancelled).toMatchObject({ status: 'Cancelled' });
  } finally { await app.close(); }
});
