import { billingEntityInput, customerInput } from '@billing/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';

export type DirectoryKind = 'entities' | 'customers';
type RecordData = { id: string; legal_name: string; is_active: boolean } & Record<string, unknown>;
type DirectoryPage = { data: RecordData[]; page: number; pageSize: number; total: number };
type Field = { name: string; label: string; type?: 'email' | 'number' | 'checkbox' | 'textarea'; required?: boolean };
type Group = { title: string; fields: Field[] };

const common: Field[] = [
  { name: 'legal_name', label: 'Legal name', required: true },
  { name: 'display_name', label: 'Display name' },
  { name: 'email', label: 'Email', type: 'email' },
  { name: 'phone', label: 'Phone' },
  { name: 'gstin', label: 'GSTIN' },
  { name: 'state_code', label: 'State code' },
];
const address = [
  { name: 'line1', label: 'Address line 1' },
  { name: 'line2', label: 'Address line 2' },
  { name: 'city', label: 'City' },
  { name: 'state', label: 'State' },
  { name: 'postal_code', label: 'Postal code' },
  { name: 'country', label: 'Country' },
];
const groupedFields: Record<DirectoryKind, Group[]> = {
  entities: [
    { title: 'Business details', fields: [
      ...common, { name: 'entity_code', label: 'Entity code', required: true },
      { name: 'gst_registered', label: 'GST registered', type: 'checkbox' },
      { name: 'pan', label: 'PAN' },
    ] },
    { title: 'Invoice defaults', fields: [
      { name: 'invoice_prefix', label: 'Invoice prefix' },
      { name: 'default_due_days', label: 'Payment due days', type: 'number' },
      { name: 'financial_year_start_month', label: 'Financial year start month (1-12)', type: 'number' },
      { name: 'upi_id', label: 'UPI ID' },
      { name: 'payment_instructions', label: 'Payment instructions', type: 'textarea' },
    ] },
  ],
  customers: [{ title: 'Customer details', fields: [
    ...common, { name: 'contact_name', label: 'Contact name' },
    { name: 'country', label: 'Customer country' },
    { name: 'payment_terms_days', label: 'Payment terms in days', type: 'number' },
    { name: 'notes', label: 'Notes', type: 'textarea' },
  ] }],
};

const nestedFields = {
  billing_address: { title: 'Billing address', fields: address },
  shipping_address: { title: 'Shipping address', fields: address },
  bank_details: { title: 'Bank details', fields: [
    { name: 'account_holder', label: 'Account holder' },
    { name: 'bank_name', label: 'Bank name' },
    { name: 'account_number', label: 'Account number' },
    { name: 'ifsc', label: 'IFSC code' },
  ] },
};
type NestedKey = keyof typeof nestedFields;
const inputStyle = 'mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm';
const primary = 'rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50';
const secondary = 'rounded-md border border-border px-3 py-2 text-sm font-medium disabled:opacity-50';

function FormFields({ fields, values, prefix = '' }: {
  fields: Field[]; values?: Record<string, unknown>; prefix?: string;
}) {
  return fields.map(({ name, label, type, required }) => {
    const value = values?.[name];
    const inputName = prefix + name;
    const text = typeof value === 'string' || typeof value === 'number' ? String(value) : '';
    if (type === 'checkbox') {
      return <label key={name} className="flex items-center gap-2 self-end py-2 text-sm">
        <input name={inputName} type="checkbox" defaultChecked={value === true} /> {label}
      </label>;
    }
    return <label key={name} className={type === 'textarea' ? 'text-sm sm:col-span-2' : 'text-sm'}>
      {label}{required && ' *'}
      {type === 'textarea'
        ? <textarea className={inputStyle} name={inputName} defaultValue={text} rows={3} />
        : <input className={inputStyle} name={inputName} type={type ?? 'text'} defaultValue={text} required={required} />}
    </label>;
  });
}

function DirectoryEditor({ kind, record, busy, error, onSave, onCancel }: {
  kind: DirectoryKind; record?: RecordData; busy: boolean; error?: string;
  onSave: (payload: object) => void; onCancel: () => void;
}) {
  const [validation, setValidation] = useState('');
  const groups = groupedFields[kind];
  const nested: NestedKey[] = ['billing_address', kind === 'entities' ? 'bank_details' : 'shipping_address'];
  const defaults = kind === 'entities' ? { default_due_days: 30, financial_year_start_month: 4 } : {};
  const values = record ?? defaults;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const input: Record<string, unknown> = {};
    for (const { fields } of groups) {
      for (const { name, type, required } of fields) {
        const value = String(form.get(name) ?? '').trim();
        if (type === 'checkbox') input[name] = form.has(name);
        else if (type === 'number') input[name] = value ? Number(value) : null;
        else input[name] = required ? value : value || null;
      }
    }
    for (const key of nested) {
      const fields = { ...(record?.[key] as Record<string, string> | undefined) };
      for (const { name } of nestedFields[key].fields) {
        const value = String(form.get(key + '.' + name) ?? '').trim();
        if (value) fields[name] = value;
        else delete fields[name];
      }
      input[key] = key === 'shipping_address' && Object.keys(fields).length === 0 ? null : fields;
    }
    if (kind === 'entities' && input.gst_registered && !input.gstin) {
      setValidation('Enter a GSTIN for a GST-registered entity.');
      return;
    }
    const schema = kind === 'entities' ? billingEntityInput : customerInput;
    const parsed = schema.safeParse(input);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const field = groups.flatMap((group) => group.fields).find(({ name }) => name === issue.path[0]);
      setValidation(field ? field.label + ': ' + issue.message : 'Check the address and bank details for invalid values.');
      return;
    }
    setValidation('');
    onSave(parsed.data);
  }

  return <form onSubmit={submit} className="space-y-6 rounded-xl border border-border p-5">
    <fieldset disabled={busy} className="space-y-6">
      {groups.map(({ title, fields }) => <fieldset key={title} className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-3 font-medium">{title}</legend>
        <FormFields fields={fields} values={values} />
      </fieldset>)}
      {nested.map((key) => <fieldset key={key} className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-3 font-medium">{nestedFields[key].title}</legend>
        <FormFields fields={nestedFields[key].fields} values={record?.[key] as Record<string, unknown> | undefined} prefix={key + '.'} />
      </fieldset>)}
    </fieldset>
    {(validation || error) && <p className="text-sm text-red-700" role="alert">{validation || error}</p>}
    <div className="flex gap-3">
      <button className={primary} disabled={busy}>{busy ? 'Saving...' : 'Save changes'}</button>
      <button className={secondary} type="button" disabled={busy} onClick={onCancel}>Cancel</button>
    </div>
  </form>;
}

export function Directory({ kind, apiUrl, token, workspaceId }: {
  kind: DirectoryKind; apiUrl: string; token: string; workspaceId: string;
}) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [active, setActive] = useState('');
  const [editor, setEditor] = useState<RecordData | 'new' | null>(null);
  const [message, setMessage] = useState('');
  const queryClient = useQueryClient();
  const scope = ['directory', workspaceId, kind];
  const noun = kind === 'entities' ? 'billing entity' : 'customer';
  const title = kind === 'entities' ? 'Billing entities' : 'Customers';

  async function request<T>(suffix: string, signal?: AbortSignal, body?: object, method = 'GET'): Promise<T> {
    const response = await fetch(apiUrl + '/' + kind + suffix, {
      method, signal,
      headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) {
      if (response.status === 401) throw new Error('Your session expired. Sign out and sign in again.');
      const error = await response.json().catch(() => null);
      throw new Error(error?.error || 'Request failed. Try again.');
    }
    return response.json();
  }

  const list = useQuery({
    queryKey: [...scope, page, search, active],
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ page: String(page), pageSize: '25' });
      if (search) params.set('search', search);
      if (active) params.set('active', active);
      return request<DirectoryPage>('?' + params, signal);
    },
    retry: false,
  });
  const save = useMutation({
    mutationFn: ({ id, payload }: { id?: string; payload: object }) =>
      request<RecordData>(id ? '/' + id : '', undefined, payload, id ? 'PATCH' : 'POST'),
    onSuccess: async () => {
      setEditor(null);
      setMessage('Changes saved.');
      await queryClient.invalidateQueries({ queryKey: scope });
    },
  });

  function open(record: RecordData | 'new') {
    save.reset();
    setMessage('');
    setEditor(record);
  }

  return <section className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-3xl font-semibold">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {kind === 'entities' ? 'Manage the businesses that issue your invoices.' : 'Manage the customer directory shared across your billing entities.'}
        </p>
      </div>
      {!editor && <button className={primary} disabled={save.isPending} onClick={() => open('new')}>Add {noun}</button>}
    </div>
    {editor ? <>
      <h2 className="text-lg font-medium">{editor === 'new' ? 'New' : 'Edit'} {noun}</h2>
      <DirectoryEditor key={editor === 'new' ? editor : editor.id}
        kind={kind} record={editor === 'new' ? undefined : editor} busy={save.isPending} error={save.error?.message}
        onCancel={() => setEditor(null)}
        onSave={(payload) => save.mutate({ id: editor === 'new' ? undefined : editor.id, payload })} />
    </> : <>
      <form className="flex flex-wrap items-end gap-3" onSubmit={(event) => {
        event.preventDefault();
        setSearch(String(new FormData(event.currentTarget).get('search') ?? '').trim());
        setPage(1);
      }}>
        <label className="text-sm">Search by legal name
          <input className={inputStyle} name="search" type="search" maxLength={100} defaultValue={search} />
        </label>
        <button className={secondary}>Search</button>
        <label className="text-sm">Status
          <select className={inputStyle} value={active} onChange={(event) => { setActive(event.target.value); setPage(1); }}>
            <option value="">All statuses</option><option value="true">Active</option><option value="false">Archived</option>
          </select>
        </label>
      </form>
      {message && <p role="status">{message}</p>}
      {save.error && <p className="text-red-700" role="alert">{save.error.message}</p>}
      {list.isPending && <p role="status">Loading {title.toLowerCase()}...</p>}
      {list.isError && <div role="alert" className="flex flex-wrap items-center gap-3">
        <p>{list.error.message}</p><button className={secondary} onClick={() => void list.refetch()}>Retry</button>
      </div>}
      {list.data && <>
        {list.data.data.length === 0 ? <p className="rounded-lg border border-border p-5">No records match your filters.</p> :
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted"><tr>
                <th className="p-3">Legal name</th><th className="p-3">{kind === 'entities' ? 'Code' : 'Email'}</th>
                <th className="p-3">Status</th><th className="p-3">Actions</th>
              </tr></thead>
              <tbody>{list.data.data.map((record) => <tr key={record.id} className="border-t border-border">
                <td className="p-3 font-medium">{record.legal_name}</td>
                <td className="p-3">{String(record[kind === 'entities' ? 'entity_code' : 'email'] ?? '-')}</td>
                <td className="p-3">{record.is_active ? 'Active' : 'Archived'}</td>
                <td className="p-3"><div className="flex gap-2">
                  <button className={secondary} disabled={save.isPending} aria-label={'Edit ' + record.legal_name} onClick={() => open(record)}>Edit</button>
                  <button className={secondary} disabled={save.isPending}
                    aria-label={(record.is_active ? 'Archive ' : 'Restore ') + record.legal_name} onClick={() => {
                      setMessage('');
                      save.mutate({ id: record.id, payload: { is_active: !record.is_active } });
                    }}>{record.is_active ? 'Archive' : 'Restore'}</button>
                </div></td>
              </tr>)}</tbody>
            </table>
          </div>}
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span>Page {page} · {list.data.total} records</span>
          <button className={secondary} disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</button>
          <button className={secondary} disabled={page * list.data.pageSize >= list.data.total} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      </>}
    </>}
  </section>;
}
