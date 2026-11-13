import { Dropdown } from './dropdown';
import { apiRequest } from './api';
import { Building2, FileText, Plus } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { billingEntityInput, customerInput } from '@billing/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';

export type DirectoryKind = 'entities' | 'customers';
type RecordData = { id: string; legal_name: string; is_active: boolean } & Record<string, unknown>;
type DirectoryPage = { data: RecordData[]; page: number; pageSize: number; total: number };
type Field = { name: string; label: string; type?: 'email' | 'number' | 'checkbox' | 'textarea' | 'tel'; required?: boolean };
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
      ...common, { name: 'entity_code', label: 'Company code (short name)', required: true },
      { name: 'gst_registered', label: 'GST registered', type: 'checkbox' },
      { name: 'pan', label: 'PAN' },
    ] },
    { title: 'Invoice defaults', fields: [
      { name: 'invoice_prefix', label: 'Invoice prefix' },
      { name: 'dc_prefix', label: 'Delivery challan prefix' },
      { name: 'default_due_days', label: 'Payment due days', type: 'number' },
      { name: 'financial_year_start_month', label: 'Financial year start month (1-12)', type: 'number' },
      { name: 'upi_id', label: 'UPI ID' },
      { name: 'payment_instructions', label: 'Payment instructions', type: 'textarea' },
    ] },
  ],
  customers: [{ title: 'Customer details', fields: [
    { name: 'legal_name', label: 'Name', required: true },
    { name: 'email', label: 'Email (optional)', type: 'email' },
    { name: 'phone', label: 'Mobile number', type: 'tel', required: true },
    { name: 'customer_address', label: 'Address', type: 'textarea', required: true },
    { name: 'gstin', label: 'GSTIN (optional)' },
    { name: 'contact_name', label: 'Contact person name', required: true },
    { name: 'contact_phone', label: 'Contact person mobile number', type: 'tel', required: true },
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
const inputStyle = 'workspace-input';
const primary = 'workspace-primary';
const secondary = 'workspace-control';

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
        ? <textarea className={inputStyle} name={inputName} defaultValue={text} required={required} rows={3} />
        : <input className={inputStyle} name={inputName} type={type ?? 'text'} defaultValue={text} required={required} />}
    </label>;
  });
}

export function DirectoryEditor({ kind, record, busy, error, onSave, onCancel }: {
  kind: DirectoryKind; record?: RecordData; busy: boolean; error?: string;
  onSave: (payload: object) => void; onCancel: () => void;
}) {
  const [validation, setValidation] = useState('');
  const groups = groupedFields[kind];
  const nested: NestedKey[] = kind === 'entities' ? ['billing_address', 'bank_details'] : [];
  const defaults = kind === 'entities' ? { default_due_days: 30, financial_year_start_month: 4 } : {};
  const values = kind === 'customers'
    ? { ...record, customer_address: (record?.billing_address as Record<string, string> | undefined)?.line1 ?? '' }
    : record ?? defaults;

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
    if (kind === 'customers') {
      input.billing_address = { ...(record?.billing_address as Record<string, string> | undefined), line1: input.customer_address };
      delete input.customer_address;
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

  const essentials = ['legal_name', 'entity_code', 'email', 'phone', 'customer_address', 'contact_name', 'contact_phone'];
  return <form onSubmit={submit} className="workspace-card directory-editor">
    <p className="workspace-note">Fields marked * are required. You can fill in the rest later.</p>
    <fieldset disabled={busy} className="space-y-5">
      {kind === 'customers' ? <fieldset className="workspace-form"><legend>Customer details</legend><FormFields fields={groups[0].fields} values={values} /></fieldset> : <><fieldset className="workspace-form">
        <legend>Basic details</legend>
        <FormFields fields={groups[0].fields.filter(field => essentials.includes(field.name))} values={values} />
      </fieldset>
      <details>
        <summary>More business and tax details</summary>
        <div className="space-y-4">
          {groups.map(({ title, fields }) => <fieldset key={title} className="workspace-form">
            <legend>{title}</legend>
            <FormFields fields={fields.filter(field => !essentials.includes(field.name))} values={values} />
          </fieldset>)}
        </div>
      </details>
      </>}
      {nested.map((key) => <details key={key}>
        <summary>{nestedFields[key].title}</summary>
        <div className="workspace-form"><FormFields fields={nestedFields[key].fields} values={record?.[key] as Record<string, unknown> | undefined} prefix={key + '.'} /></div>
      </details>)}
    </fieldset>
    {(validation || error) && <p className="text-sm text-red-700" role="alert">{validation || error}</p>}
    <div className="flex gap-3">
      <button className={primary} disabled={busy}>{busy ? 'Saving...' : 'Save changes'}</button>
      <button className={secondary} type="button" disabled={busy} onClick={onCancel}>Cancel</button>
    </div>
  </form>;
}

export function Directory({ kind, workspaceId, entityId }: {
  kind: DirectoryKind; workspaceId: string; entityId?: string;
}) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [active, setActive] = useState('');
  const [params, setParams] = useSearchParams();
  const [editor, setEditor] = useState<RecordData | 'new' | null>(
    params.get('create') === '1' ? 'new' : null,
  );
  function closeEditor() {
    setEditor(null);
    if (params.has('create')) setParams({}, { replace: true });
  }
  const [message, setMessage] = useState('');
  const queryClient = useQueryClient();
  const scope = ['directory', workspaceId, kind, entityId];
  const noun = kind === 'entities' ? 'company' : 'customer';
  const title = kind === 'entities' ? 'Companies' : 'Customers';

  async function request<T>(suffix: string, signal?: AbortSignal, body?: object, method = 'GET'): Promise<T> {
    const response = await apiRequest('/api/v1' + (kind === 'customers' ? '/entities/' + entityId + '/customers' : '/entities') + suffix, {
      method, signal,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}) },
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
      closeEditor();
      setMessage('Changes saved.');
      await queryClient.invalidateQueries({ queryKey: kind === 'entities' ? scope.slice(0, 3) : scope });
      if (kind === 'customers') {
        await queryClient.invalidateQueries({ queryKey: ['invoice-parties', workspaceId, entityId] });
      }
    },
  });

  function open(record: RecordData | 'new') {
    save.reset();
    setMessage('');
    setEditor(record);
  }

  return <section className="space-y-5">
    <div className="workspace-heading">
      <div>
        <h1>{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {kind === 'entities' ? 'Manage the businesses that issue your invoices.' : 'Manage customers for the selected company.'}
        </p>
      </div>
      {!editor && <button className="workspace-primary" disabled={save.isPending} onClick={() => open('new')}><Plus size={16} /> {kind === 'entities' ? 'Add Company' : 'Add Customer'}</button>}
    </div>
    {editor ? <>
      <h2 className="text-lg font-medium">{editor === 'new' ? 'New' : 'Edit'} {noun}</h2>
      <DirectoryEditor key={editor === 'new' ? editor : editor.id}
        kind={kind} record={editor === 'new' ? undefined : editor} busy={save.isPending} error={save.error?.message}
        onCancel={closeEditor}
        onSave={(payload) => save.mutate({ id: editor === 'new' ? undefined : editor.id, payload })} />
    </> : <>
      <form className="flex flex-wrap items-end gap-3" onSubmit={(event) => {
        event.preventDefault();
        setSearch(String(new FormData(event.currentTarget).get('search') ?? '').trim());
        setPage(1);
      }}>
        <label className="text-sm">Find by name
          <input className={inputStyle} name="search" type="search" maxLength={100} defaultValue={search} />
        </label>
        <button className={secondary}>Search</button>
        <label className="text-sm">Status
          <Dropdown className={inputStyle} value={active} onChange={(event) => { setActive(event.target.value); setPage(1); }}>
            <option value="">All statuses</option><option value="true">Active</option><option value="false">Archived</option>
          </Dropdown>
        </label>
      </form>
      {message && <p role="status">{message}</p>}
      {save.error && <p className="text-red-700" role="alert">{save.error.message}</p>}
      {list.isPending && <p role="status">Loading {title.toLowerCase()}...</p>}
      {list.isError && <div role="alert" className="flex flex-wrap items-center gap-3">
        <p>{list.error.message}</p><button className={secondary} onClick={() => void list.refetch()}>Retry</button>
      </div>}
      {list.data && <>
        {list.data.data.length === 0 ? <p className="rounded-lg border border-border p-5">No matches. Try another name or choose All statuses.</p> :
                    kind === 'entities' ? <div className="workspace-companies">
            {list.data.data.map((record, index) => <article className="workspace-card" key={record.id}>
              <div className="workspace-heading"><span className={'metric-icon ' + (index % 2 ? 'green' : 'teal')}><Building2 size={19} /></span>
                <span className={'workspace-badge ' + (record.is_active ? 'paid' : 'archived')}>{record.is_active ? 'Active' : 'Archived'}</span></div>
              <h2>{record.legal_name}</h2>
              <dl><div><dt>GSTIN</dt><dd>{String(record.gstin ?? '—')}</dd></div><div><dt>Invoice Prefix</dt><dd>{String(record.invoice_prefix ?? record.entity_code ?? '—')}</dd></div></dl>
              <div className="flex flex-wrap gap-2">
                <button className={secondary} disabled={save.isPending} onClick={() => open(record)}>Edit</button>
                <Link className="workspace-control" to={'/entities/' + record.id + '/settings'}><FileText size={14} /> Company Settings</Link>
                <button className={secondary} disabled={save.isPending} onClick={() => {
                  setMessage('');
                  save.mutate({ id: record.id, payload: { is_active: !record.is_active } });
                }}>{record.is_active ? 'Archive' : 'Restore'}</button>
              </div>
            </article>)}
          </div> : <div className="workspace-card overflow-x-auto">
            <table className="workspace-table customer-table" role="table" aria-label="Customers">
              <thead className="bg-muted"><tr>
                <th className="p-3">Legal name</th><th className="p-3">GSTIN</th>
                <th className="p-3">Status</th><th className="p-3">Actions</th>
              </tr></thead>
              <tbody>{list.data.data.map((record) => <tr key={record.id} className="border-t border-border">
                <td className="p-3 font-medium"><Link className="document-link" to={'/entities/' + entityId + '/customers/' + record.id}>{record.legal_name}</Link></td>
                <td className="p-3" data-label="GSTIN">{String(record.gstin ?? '-')}</td>
                <td className="p-3" data-label="Status"><span className={'workspace-badge ' + (record.is_active ? 'paid' : 'archived')}>{record.is_active ? 'Active' : 'Archived'}</span></td>
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












