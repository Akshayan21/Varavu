import { Dropdown } from './dropdown';
import { CustomerPicker } from './customer-picker';
import { DirectoryEditor } from './directory';
import { apiRequest } from './api';
import type { Entity } from './entity-selector';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plus, Printer } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { BillPaper } from './billing';
import { lineAmount, minorUnits, money, quantityPattern, ratePattern, readBills, saveBill, today, type Bill, type BillLine, type Party } from './mock-bills';
import { StyleField } from './style-field';
import { useCatalog } from './catalog';
import { mockMode } from './api';

function defaultDue(issueDate: string, days: number) {
  const date = new Date(issueDate + 'T00:00:00Z');
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function InvoiceDraft({ workspaceId, seller }: { workspaceId: string; seller: Entity }) {
  const { billId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const existing = billId ? readBills().find(bill => bill.id === billId && bill.seller.id === seller.id && bill.status === 'Draft') : undefined;
  const copy = location.state?.copy as Bill | undefined;
  const initial = existing ?? (copy?.seller.id === seller.id ? copy : undefined);
  const queryClient = useQueryClient();
  const [creatingCustomer, setCreatingCustomer] = useState(false);
  const [customerId, setCustomerId] = useState(initial?.customer.id ?? (new URLSearchParams(location.search).get('customer') || ''));
  const [due, setDue] = useState(initial?.due ?? defaultDue(today(), seller.default_due_days ?? 30));
  const [reference, setReference] = useState(initial?.reference ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [discount, setDiscount] = useState(initial?.discountCents ? String(initial.discountCents / 100) : '');
  const [tax, setTax] = useState(initial?.taxBasisPoints ? String(initial.taxBasisPoints / 100) : '');
  const [bank, setBank] = useState(initial?.seller.bank_details ?? seller.bank_details ?? {});
  const [upi, setUpi] = useState(initial?.seller.upi_id ?? seller.upi_id ?? '');
  const [lines, setLines] = useState<BillLine[]>(initial?.lines.map(({amountCents,taxableCents,taxCents,...line})=>line) ?? [{ id: 1, description: '', quantity: '1', rate: '' }]);
  const [printable, setPrintable] = useState(false);
  const [error, setError] = useState('');
  const [date, setDate] = useState(initial?.date ?? today());
  const [draftId] = useState(existing?.id ?? crypto.randomUUID());
  const [saving,setSaving] = useState(false);
  const catalog=useCatalog(seller.id);

  const directory = useQuery({
    queryKey: ['invoice-parties', workspaceId, seller.id],
    queryFn: async ({ signal }) => {
      async function all(kind: string) {
        const records: Party[] = [];
        let page = 1;
        do {
          const response = await apiRequest('/api/v1/entities/' + seller.id + '/' + kind + '?active=true&pageSize=100&page=' + page, {
            signal,
          });
          if (!response.ok) throw new Error('Could not load companies and customers.');
          const result: { data: Party[]; total: number } = await response.json();
          records.push(...result.data);
          if (!result.data.length || records.length >= result.total) return records;
          page += 1;
        } while (!signal.aborted);
        return records;
      }
      const customers = await all('customers');
      return { customers };
    },
  });

  const createCustomer = useMutation({
    mutationFn: async (payload: object) => {
      const response = await apiRequest('/api/v1/entities/' + seller.id + '/customers', {
        method: 'POST', body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error || 'Could not save the customer.');
      }
      return await response.json() as Party;
    },
    onSuccess: async (saved) => {
      queryClient.setQueryData<{ customers: Party[] }>(['invoice-parties', workspaceId, seller.id],
        previous => ({ customers: [...(previous?.customers ?? []), saved] }));
      setCustomerId(saved.id);
      updateDue(date, seller, saved);
      setCreatingCustomer(false);
      await queryClient.invalidateQueries({ queryKey: ['directory', workspaceId, 'customers', seller.id] });
    },
  });
  const customer = directory.data?.customers.find(row => row.id === customerId);
  const amounts = lines.map(lineAmount);
  const total = amounts.reduce((sum, amount) => sum + amount, 0);
  const discountCents = ratePattern.test(discount) ? minorUnits(discount, 2) : 0;
  const taxBasisPoints = ratePattern.test(tax) && Number(tax) <= 100 ? minorUnits(tax, 2) : 0;
  const validAdjustments = (!discount || ratePattern.test(discount) && discountCents <= total) &&
    (!tax || ratePattern.test(tax) && Number(tax) <= 100) && total <= Number.MAX_SAFE_INTEGER / 2;
  const ready = validAdjustments && customer && date && due && due >= date && Number.isSafeInteger(total) && lines.every(line =>
    line.description.trim() && quantityPattern.test(line.quantity) && minorUnits(line.quantity, 3) > 0 && ratePattern.test(line.rate));
  const previewBill: Bill = {
    id: draftId,
    seller: { ...seller, bank_details: bank, upi_id: upi },
    accent: mockMode ? localStorage.getItem('thogai-bill-accent-' + seller.id) ?? undefined
      : catalog.data?.document_templates.find(row=>row.id===seller.default_invoice_template_id)?.settings_json.accent,
    templatePreset:catalog.data?.document_templates.find(row=>row.id===seller.default_invoice_template_id)?.settings_json.preset,
    customer: customer ?? { id: '', legal_name: 'Select a customer' },
    date, due, reference, notes, lines, discountCents, taxBasisPoints, status: 'Draft', receipts: [],
  };
  const validationMessage = validAdjustments
    ? 'Choose a customer, enter valid dates, and complete every item.'
    : 'Enter a discount no larger than the subtotal and a tax rate from 0 to 100%.';

  async function persist() {
    if(saving) return;
    if (!ready) {
      setError(validationMessage);
      return;
    }
    setSaving(true);
    try {
      const saved = await saveBill({ ...previewBill, id: previewBill.id || crypto.randomUUID(), version:existing?.version });
      navigate('/entities/' + seller.id + '/invoices/' + saved.id);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not save the bill.');
    } finally {setSaving(false);}
  }

  function updateDue(issueDate: string, party?: Entity, buyer?: Party) {
    if (!issueDate) return;
    const result = new Date(issueDate + 'T00:00:00Z');
    result.setUTCDate(result.getUTCDate() + (buyer?.payment_terms_days ?? party?.default_due_days ?? 30));
    setDue(result.toISOString().slice(0, 10));
  }

  function preview(event: FormEvent) {
    event.preventDefault();
    if (!ready) {
      setError(validationMessage);
      return;
    }
    setError('');
    setPrintable(true);
  }

  if (billId && !existing) return <section className="workspace-card"><h1>Draft unavailable</h1><Link className="workspace-control workspace-back" to={'/entities/' + seller.id + '/invoices'}><ArrowLeft size={16} aria-hidden="true" />Back to Billing</Link></section>;
  if (directory.isPending) return <p role="status">Loading companies and customers…</p>;
  if (directory.isError) return <div role="alert"><p>{directory.error.message}</p><button className="workspace-control" onClick={() => void directory.refetch()}>Retry</button></div>;
  return <>
    <div className="workspace-heading invoice-screen"><div><Link className="workspace-control workspace-back" to={'/entities/' + seller.id + '/invoices'}><ArrowLeft size={16} aria-hidden="true" />Back to Billing</Link><h1>{printable ? 'Review your bill' : existing ? 'Edit draft' : 'Create a bill'}</h1><p>{printable ? 'Check the details below before printing.' : 'Choose a customer, add the work you did, and review the draft.'}</p></div></div>
    {printable && ready ? <>
      <div className="invoice-screen flex flex-wrap gap-3">
        <button className="workspace-control workspace-back-action" onClick={() => setPrintable(false)}><ArrowLeft size={16} aria-hidden="true" />Back to editing</button>
        <button className="workspace-primary" disabled={saving} onClick={()=>void persist()}>{saving?'Saving…':'Save draft'}</button>
        <button className="workspace-control" onClick={() => window.print()}><Printer size={16} /> Print / Save PDF</button>
      </div>
      {error && <p role="alert" className="invoice-screen">{error}</p>}
      <BillPaper bill={previewBill} />
    </> : <div className="bill-editor-layout"><form className="bill-editor-panel invoice-screen" onSubmit={preview}>
      <section className="workspace-form"><h2>Issuing company and customer</h2>
        <label>Company (Issuer)<input readOnly value={seller.legal_name} /></label>
        <CustomerPicker customers={directory.data.customers} value={customerId}
          onSelect={id => {
            setCustomerId(id);
            updateDue(date, seller, directory.data.customers.find(row => row.id === id));
          }}
          onCreate={() => { createCustomer.reset(); setCreatingCustomer(true); }} />
      </section>
      <section className="workspace-form"><h2>Bill details</h2>
        <label>Invoice date<input required type="date" value={date} onChange={event => { setDate(event.target.value); updateDue(event.target.value, seller, customer); }} /></label>
        <label>Due date<input required type="date" min={date} value={due} onChange={event => setDue(event.target.value)} /></label>
        <label>Reference / PO number<input value={reference} maxLength={100} onChange={event => setReference(event.target.value)} /></label>

      </section>
      <section>
        <h2>Garment printing items</h2>
        <p>Enter the work or item, how many, and the price for one.</p>
        <div className="invoice-items">{lines.map((line, index) => <fieldset className="invoice-item" key={line.id}>
          <div className="workspace-heading"><strong>Item {index + 1}</strong>
            {lines.length > 1 && <button type="button" className="workspace-control" aria-label={'Remove item ' + (index + 1)} onClick={() => setLines(rows => rows.filter(row => row.id !== line.id))}>Remove</button>}
          </div>
          <div className="workspace-form">
            {(['description', 'quantity', 'rate'] as const).map(key => <label key={key}>
              {{description:'Production / particulars', quantity:'Quantity (pcs)', rate:'Rate per piece (₹)'}[key]}
              <input required aria-label={key + ' for item ' + (index + 1)}
                placeholder={key === 'description' ? 'e.g. Front print on T-shirt' : undefined}
                inputMode={key === 'description' ? 'text' : 'decimal'} maxLength={key === 'description' ? 300 : 11}
                value={line[key]} onChange={event => setLines(rows => rows.map(row => row.id === line.id ? { ...row, [key]: event.target.value } : row))} />
            </label>)}
          </div>
          <div className="workspace-form bill-printing-fields">
            <StyleField entityId={seller.id} value={line.style ?? ''}
              onChange={value=>setLines(rows=>rows.map(row=>row.id===line.id?{...row,style:value,styleId:null}:row))}
              onResolve={(input,style)=>setLines(rows=>rows.map(row=>row.id===line.id && row.style===input?{...row,style:style.style_number,styleId:style.id}:row))} />
            {(['printType', 'placement'] as const).map(key => {
              const options = mockMode ? (key === 'printType' ? ['DTF', 'Sublimation', 'Heat Transfer', 'Puff', 'Plastisol', 'HD / High Density', 'Screen Printing', 'Other'] :
                ['Front', 'Back', 'Left Chest', 'Right Chest', 'Sleeve', 'Neck', 'Other'])
                : (key==='printType'?catalog.data?.print_types:catalog.data?.placements)?.filter(row=>row.is_active).map(row=>row.label) ?? [];
              const value = line[key] ?? '';
              return <label key={key}>{key === 'printType' ? 'Print type' : 'Placement'}
                <Dropdown value={value} onChange={event => setLines(rows => rows.map(row => row.id === line.id ? { ...row, [key]: event.target.value } : row))}>
                  <option value="">Select (optional)</option>
                  {value && !options.includes(value) && <option>{value}</option>}
                  {options.map(option => <option key={option}>{option}</option>)}
                </Dropdown>
              </label>;
            })}
          </div>
          <p className="mt-2 text-sm">Item amount <strong className="invoice-total">{money(amounts[index])}</strong></p>
        </fieldset>)}</div>
        <div className="workspace-heading mt-4">
          <button type="button" className="workspace-control" onClick={() => setLines(rows => [...rows, { id: Math.max(...rows.map(row => row.id)) + 1, description: '', quantity: '1', rate: '' }])}><Plus size={15} /> Add another item</button>
          <strong className="invoice-total">Subtotal before tax {money(total)}</strong>
        </div>
      </section>
      <section className="workspace-form"><h2>Commercial summary</h2>
        <label>Discount (₹)<input inputMode="decimal" value={discount} placeholder="0.00" onChange={event => setDiscount(event.target.value)} /></label>
        <label>Tax (%)<input inputMode="decimal" value={tax} placeholder="0" onChange={event => setTax(event.target.value)} /></label>
      </section>
      <section className="workspace-form"><h2>Bank details and terms</h2>
        {([['bank_name', 'Bank name'], ['account_holder', 'Account holder'], ['account_number', 'Account number'], ['ifsc', 'IFSC code']] as const).map(([key, label]) =>
          <label key={key}>{label}<input value={bank[key] ?? ''} onChange={event => setBank(previous => ({ ...previous, [key]: event.target.value }))} /></label>)}
        <label>UPI ID<input value={upi} onChange={event => setUpi(event.target.value)} /></label>
        <label>Terms and notes<textarea value={notes} maxLength={2000} onChange={event => setNotes(event.target.value)} /></label>
      </section>
      {error && <p role="alert">{error}</p>}
      <div className="flex flex-wrap gap-2"><button className="workspace-primary" type="submit">Review bill</button><button className="workspace-control" type="button" disabled={saving} onClick={()=>void persist()}>{saving?'Saving…':'Save draft'}</button></div>
    </form><section className="bill-live-preview" aria-label="Live bill preview"><div className="bill-preview-heading invoice-screen"><strong>Live A4 invoice preview</strong><span>Updates as you type</span></div><BillPaper bill={previewBill} /></section></div>}
    {creatingCustomer && <dialog className="workspace-card customer-create-dialog" aria-labelledby="create-customer-title"
      ref={element => { if (element && !element.open) element.showModal(); }}
      onCancel={event => { event.preventDefault(); if (!createCustomer.isPending) setCreatingCustomer(false); }}>
      <header className="workspace-heading"><div><h2 id="create-customer-title">Create customer</h2><p>{seller.legal_name}</p></div>
        <button type="button" className="workspace-control" aria-label="Close customer form" disabled={createCustomer.isPending} onClick={() => setCreatingCustomer(false)}>Close</button>
      </header>
      <DirectoryEditor kind="customers" busy={createCustomer.isPending} error={createCustomer.error?.message}
        onSave={payload => createCustomer.mutate(payload)} onCancel={() => setCreatingCustomer(false)} />
    </dialog>}
  </>;
}









