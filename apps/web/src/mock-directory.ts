type Row = { id: string; legal_name: string; is_active: boolean; entity_id?: string } & Record<string, unknown>;
type Store = { entities: Row[]; customers: Row[] };

const key = 'thogai-mock-directory-v1';
const alpha = '460e73a5-5733-41df-bcd0-f87134395c01';
const veera = '460e73a5-5733-41df-bcd0-f87134395c02';
const seed: Store = {
  entities: [
    { id: alpha, legal_name: 'Alpha Solutions Pvt. Ltd.', entity_code: 'ALP', invoice_prefix: 'ALP', default_due_days: 30, is_active: true, billing_address: { city: 'Coimbatore', state: 'Tamil Nadu' } },
    { id: veera, legal_name: 'Veera Tech Services', entity_code: 'VTS', invoice_prefix: 'VTS', default_due_days: 15, is_active: true, billing_address: { city: 'Tiruppur', state: 'Tamil Nadu' } },
  ],
  customers: [
    { id: '460e73a5-5733-41df-bcd0-f87134395c03', entity_id: alpha, legal_name: 'Sri Kumaran Foods', is_active: true },
    { id: '460e73a5-5733-41df-bcd0-f87134395c04', entity_id: veera, legal_name: 'Anand Textiles', is_active: true },
  ],
};

function readStore(): Store {
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed?.entities) && Array.isArray(parsed?.customers)) return parsed;
    }
  } catch {
    // A fresh sample directory is usable if a prior browser value is invalid.
  }
  return structuredClone(seed);
}

export async function mockRequest(path: string, options: RequestInit = {}): Promise<Response> {
  options.signal?.throwIfAborted();
  const url = new URL(path, 'http://mock.local');
  const parts = url.pathname.replace(/^\/api\/v1\//, '').split('/');
  const scoped = parts[0] === 'entities' && parts[2] === 'customers' && parts.length <= 4;
  const companyDirectory = parts[0] === 'entities' && parts.length <= 2;
  const method = options.method ?? 'GET';
  const store = readStore();
  const entityId = scoped ? parts[1] : undefined;
  const id = scoped ? parts[3] : parts[1];
  const fail = (status: number, error: string) => Response.json({ error }, { status });

  if (!scoped && !companyDirectory) return fail(404, 'Record not found.');
  if (scoped && !store.entities.some(entity => entity.id === entityId && entity.is_active)) {
    return fail(404, 'Active company not found.');
  }

  const records = scoped ? store.customers : store.entities;
  const visible = records.filter(row => !scoped || row.entity_id === entityId);
  const existing = visible.find(row => row.id === id);

  if (method === 'GET') {
    if (id) return existing ? Response.json(existing) : fail(404, 'Record not found.');
    const active = url.searchParams.get('active');
    const search = (url.searchParams.get('search') ?? '').toLowerCase();
    const page = Number(url.searchParams.get('page') ?? 1);
    const pageSize = Number(url.searchParams.get('pageSize') ?? 25);
    const matching = visible.filter(row => (!active || row.is_active === (active === 'true')) &&
      row.legal_name.toLowerCase().includes(search)).sort((a, b) => a.legal_name.localeCompare(b.legal_name));
    return Response.json({ data: matching.slice((page - 1) * pageSize, page * pageSize), page, pageSize, total: matching.length });
  }

  if ((method !== 'POST' || id) && method !== 'PATCH') return fail(405, 'Unsupported operation.');
  if (method === 'PATCH' && !existing) return fail(404, 'Record not found.');
  const payload = JSON.parse(String(options.body ?? '{}'));
  if (companyDirectory && payload.entity_code && store.entities.some(row =>
    row.id !== id && row.entity_code === payload.entity_code)) return fail(409, 'A company with that code already exists.');
  const saved: Row = existing
    ? { ...existing, ...payload, id: existing.id, entity_id: existing.entity_id }
    : { ...payload, id: crypto.randomUUID(), entity_id: entityId, is_active: true };
  if (existing) records[records.indexOf(existing)] = saved;
  else records.push(saved);
  try {
    localStorage.setItem(key, JSON.stringify(store));
  } catch {
    return fail(503, 'Could not save mock data in this browser.');
  }
  return Response.json(saved, { status: method === 'POST' ? 201 : 200 });
}
