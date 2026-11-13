import { Dashboard } from './prototype-dashboard';
import { Dropdown } from './dropdown';
import { ArrowLeft, FileText, Plus, Printer, Truck } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { Entity } from './entity-selector';
import { BillPaper } from './billing';
import { billTotal, lineAmount, money, readBills, received, today, type Bill, type Party } from './mock-bills';
import { apiRequest, mockMode, requestJson, downloadPdf } from './api';
import { cachedChallans, cacheChallan } from './document-cache';
import { useCatalog } from './catalog';

type ChallanItem = { description: string; quantity: string; unit: string; remarks?: string };
export type Challan = {
  id: string; entityId: string; number: string; date: string; recipient: string;
  from: string; to: string; items: ChallanItem[]; notes: string; billId: string; billNumber?: string;
  version?:number; status?:'Draft'|'Issued'|'Cancelled';seller?:Entity;template?:{settings_json:{accent?:string}};
  acknowledgement?:{received_by:string;received_at:string};
};
type LegacyChallan = Omit<Challan, 'items'> & { items: string; quantity: string; unit: string };
const challanKey = 'thogai-mock-challans-v1';
const challanUnits = ['Pieces', 'Bundles', 'Boxes'];

export function challans(): Challan[] {
  if(!mockMode) return cachedChallans();
  const saved = localStorage.getItem(challanKey);
  if (saved) {
    const records = JSON.parse(saved) as (Challan | LegacyChallan)[];
    return records.map(record => {
      if (typeof record.items !== 'string') return record as Challan;
      const { items, quantity, unit, ...fields } = record as LegacyChallan;
      return { ...fields, items: [{ description: items, quantity, unit }] };
    });
  }
  return [
    { id: 'sample-challan-1', entityId: '460e73a5-5733-41df-bcd0-f87134395c01', number: 'ALP-DC-0001',
      date: '2026-11-06', recipient: 'Sri Kumaran Foods', from: 'Coimbatore, Tamil Nadu', to: 'Coimbatore, Tamil Nadu',
      items: [{ description: 'Printed T-shirts', quantity: '100', unit: 'Pieces' }], notes: 'Sample delivery record', billId: 'sample-bill-1' },
    { id: 'sample-challan-2', entityId: '460e73a5-5733-41df-bcd0-f87134395c02', number: 'VTS-DC-0001',
      date: '2026-11-06', recipient: 'Anand Textiles', from: 'Tiruppur, Tamil Nadu', to: 'Tiruppur, Tamil Nadu',
      items: [{ description: 'Printed garments', quantity: '100', unit: 'Pieces' }], notes: 'Sample delivery record', billId: 'sample-bill-2' },
  ];
}

function itemSummary(record: Challan) {
  return record.items.map(item => item.description).join(', ');
}

export function Challans({ entity, mode }: { entity: Entity; mode: 'list' | 'create' | 'detail' }) {
  const { challanId } = useParams();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [busy,setBusy]=useState(false);
  const [draftId]=useState(()=>crypto.randomUUID());
  const [detailAction,setDetailAction]=useState<'cancel'|'acknowledge'|null>(null);
  const catalog=useCatalog(entity.id);
  const units=mockMode?challanUnits:catalog.data?.units.filter(row=>row.is_active).map(row=>row.label) ?? [];
  const [search, setSearch] = useState('');
  const [itemIds, setItemIds] = useState(() => [crypto.randomUUID()]);
  const base = '/entities/' + entity.id + '/challans';
  const records = challans().filter(row => row.entityId === entity.id);
  const note = records.find(row => row.id === challanId);
  const companyBills = readBills().filter(bill => bill.seller.id === entity.id);
  const issued = companyBills.filter(bill => bill.status === 'Issued');
  const linked = companyBills.find(bill => bill.id === note?.billId);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if(busy) return;
    const values = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
    setError('');
    if (!values.recipient.trim() || !values.from.trim() || !values.to.trim() || !values.date) {
      setError('Enter a recipient, date, and both addresses.');
      return;
    }
    const items = itemIds.map(id => ({
      description: String(values['description-' + id] ?? '').trim(),
      quantity: String(values['quantity-' + id] ?? ''),
      unit: String(values['unit-' + id] ?? ''),
      remarks: String(values['remarks-' + id] ?? '').trim(),
    }));
    const invalid = items.findIndex(item => !item.description || !Number.isFinite(Number(item.quantity)) ||
      Number(item.quantity) <= 0 || !units.includes(item.unit));
    if (invalid >= 0) {
      setError('Check item ' + (invalid + 1) + ': enter a description, a positive quantity, and a unit.');
      return;
    }
    try {
      setBusy(true);
      const bill = values.billId ? readBills().find(row =>
        row.id === values.billId && row.seller.id === entity.id && row.status === 'Issued') : undefined;
      if (values.billId && !bill) {
        setError('Choose an issued bill from this company, or select No related bill.');
        return;
      }
      const all = challans();
      const id = crypto.randomUUID();
      const sequence = mockMode ? Math.max(0, ...all.filter(row => row.entityId === entity.id).map(row => Number(row.number?.match(/\d+$/)?.[0] ?? 0))) + 1 : 0;
      const row: Challan = { id, entityId: entity.id, number: entity.entity_code + '-DC-' + String(sequence).padStart(4, '0'),
        date: values.date, recipient: values.recipient.trim(), from: values.from.trim(), to: values.to.trim(),
        items, notes: values.notes, billId: bill?.id ?? '', billNumber: bill?.number };
      if(mockMode) localStorage.setItem(challanKey, JSON.stringify([row, ...all]));
      else {
        const saved=await requestJson<Challan>('/api/v1/entities/'+entity.id+'/challans',{method:'POST',body:JSON.stringify({id:draftId,
          recipient:row.recipient,date:row.date,from:row.from,to:row.to,items:row.items,notes:row.notes,billId:row.billId})});
        cacheChallan(saved);
        navigate(base+'/'+saved.id);
        return;
      }
      navigate(base + '/' + id);
    } catch(err) { setError(err instanceof Error?err.message:'Could not save the delivery challan.'); }
    finally {setBusy(false);}
  }
  async function issue() {
    if(!note || busy) return;
    setBusy(true);
    try {
      const saved=await requestJson<Challan>('/api/v1'+base+'/'+note.id+'/issue',{method:'POST',body:JSON.stringify({version:note.version})});
      cacheChallan(saved);
    } catch(err) {setError(err instanceof Error?err.message:'Could not issue challan.');}
    finally {setBusy(false);}
  }
  async function submitDetail(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if(!note||busy)return;
    const form=new FormData(event.currentTarget);
    setBusy(true);setError('');
    try {
      const payload=detailAction==='cancel'?{reason:String(form.get('reason'))}
        :{receivedBy:String(form.get('receivedBy')),receivedAt:new Date().toISOString(),notes:String(form.get('notes') ?? '')};
      const saved=await requestJson<Challan>('/api/v1'+base+'/'+note.id+'/'+(detailAction==='cancel'?'cancel':'acknowledge'),{method:'POST',body:JSON.stringify(payload)});
      cacheChallan(saved);setDetailAction(null);
    } catch(err) {setError(err instanceof Error?err.message:'Could not save delivery details.');}
    finally {setBusy(false);}
  }
  if (mode === 'detail') return note ? <>
    <header className="workspace-heading invoice-screen"><div><Link className="workspace-control workspace-back" to={base}><ArrowLeft size={16} aria-hidden="true" />Back to delivery challans</Link><h1>{note.number || 'Challan draft'}</h1><p>{note.recipient} {note.status}</p></div>
      <button className="workspace-primary" onClick={() => window.print()}><Printer size={16} /> Print / Save PDF</button></header>
    {error && <p role="alert">{error}</p>}
    {!mockMode && (note.status==='Draft' ? <button className="workspace-primary" disabled={busy} onClick={()=>void issue()}>Issue challan</button>
      : <button className="workspace-control" disabled={busy} onClick={()=>{setBusy(true);void downloadPdf(entity.id,'challans',note.id).catch(err=>setError(err.message)).finally(()=>setBusy(false));}}>Download PDF</button>)}
    {!mockMode && note.status==='Issued' && <div className="invoice-screen flex gap-2">
      <button className="workspace-control" disabled={busy} onClick={()=>setDetailAction('cancel')}>Cancel challan</button>
      {!note.acknowledgement && <button className="workspace-control" disabled={busy} onClick={()=>setDetailAction('acknowledge')}>Record delivery acknowledgement</button>}
    </div>}
    {detailAction && <form className="workspace-card workspace-form invoice-screen" onSubmit={submitDetail}>
      {detailAction==='cancel'?<label>Cancellation reason<textarea name="reason" required maxLength={2000} /></label>
        :<><label>Received by<input name="receivedBy" required maxLength={200} /></label><label>Delivery notes<textarea name="notes" maxLength={2000} /></label></>}
      <button className="workspace-primary" disabled={busy}>Confirm {detailAction==='cancel'?'cancellation':'acknowledgement'}</button>
      <button className="workspace-control" type="button" disabled={busy} onClick={()=>setDetailAction(null)}>Go back</button>
    </form>}
    {note.acknowledgement && <p>Received by {note.acknowledgement.received_by} · {note.acknowledgement.received_at}</p>}
    <article className="workspace-card invoice-print-sheet document-paper">{note.status==='Cancelled' && <h2>CANCELLED</h2>}<h2>Delivery challan · {note.number || 'Draft'}</h2><p>{note.seller?.legal_name ?? entity.legal_name} · {note.date}</p>
      <div className="invoice-parties"><div><strong>From</strong><p className="whitespace-pre-wrap">{note.from}</p></div><div><strong>Deliver to {note.recipient}</strong><p className="whitespace-pre-wrap">{note.to}</p></div></div>
      <div className="overflow-x-auto"><table className="workspace-table invoice-print-table">
        <thead><tr><th>No.</th><th>Item</th><th>Quantity</th><th>Unit</th><th>Remarks</th></tr></thead>
        <tbody>{note.items.map((item, index) => <tr key={index}><td>{index + 1}</td><td>{item.description}</td><td>{item.quantity}</td><td>{item.unit}</td><td>{item.remarks || '—'}</td></tr>)}</tbody>
      </table></div>
      {note.notes && <p className="mt-4 whitespace-pre-wrap">{note.notes}</p>}
      {(linked || note.billNumber) && <p className="mt-4">Related bill: {linked
        ? <Link className="document-link" to={'/entities/' + entity.id + '/invoices/' + linked.id}>{note.billNumber ?? linked.number}</Link>
        : note.billNumber}</p>}
      <p className="mt-5">{mockMode?'Thogai mock workspace':'Thogai'}</p>
    </article></> : <section className="workspace-card"><h1>Delivery challan unavailable</h1><Link className="workspace-control workspace-back" to={base}><ArrowLeft size={16} aria-hidden="true" />Back to delivery challans</Link></section>;
  if (mode === 'create') return <>
    <header className="workspace-heading"><div><Link className="workspace-control workspace-back" to={base}><ArrowLeft size={16} aria-hidden="true" />Back to delivery challans</Link><h1>Create delivery challan</h1><p>Record what you’re sending and where it’s going.</p></div></header>
    <form className="workspace-card workspace-form" onSubmit={save}>
      <h2>Delivery details</h2>
      <label>Recipient<input name="recipient" required /></label><label>Date<input name="date" type="date" defaultValue={today()} required /></label>
      <label>From address<textarea name="from" required defaultValue={Object.values(entity.billing_address ?? {}).join(', ')} /></label><label>Delivery address<textarea name="to" required /></label>
      <label>Related bill (optional)<Dropdown name="billId"><option value="">No related bill</option>{issued.map(bill => <option value={bill.id} key={bill.id}>{bill.number} · {bill.customer.legal_name}</option>)}</Dropdown></label>
      <section className="challan-items sm:col-span-2" aria-labelledby="challan-items-title">
        <h2 id="challan-items-title">Items being delivered</h2>
        <p className="workspace-note">Add a separate row for each item or unit.</p>
        <div className="invoice-items">{itemIds.map((id, index) => <fieldset key={id} className="invoice-item">
          <legend className="font-semibold">Item {index + 1}</legend>
          <div className="workspace-form challan-item-fields">
            <label>Description<input name={'description-' + id} required maxLength={300} placeholder="e.g. Printed T-shirts" /></label>
            <label>Quantity<input type="number" name={'quantity-' + id} min="0.001" step="any" required /></label>
            <label>Unit<Dropdown name={'unit-' + id}>{units.map(unit => <option key={unit}>{unit}</option>)}</Dropdown></label>
            <label>Remarks (optional)<input name={'remarks-' + id} maxLength={300} /></label>
          </div>
          {itemIds.length > 1 && <button type="button" className="workspace-control mt-2"
            aria-label={'Remove item ' + (index + 1)} onClick={() => setItemIds(ids => ids.filter(value => value !== id))}>Remove item</button>}
        </fieldset>)}</div>
        <button type="button" className="workspace-control mt-4" onClick={() => setItemIds(ids => [...ids, crypto.randomUUID()])}><Plus size={16} /> Add item</button>
      </section>
      <label>Notes<textarea name="notes" /></label>
      {error && <p role="alert">{error}</p>}
      <div className="sm:col-span-2"><button className="workspace-primary" disabled={busy}>{busy?'Saving…':'Save delivery challan'}</button></div>
    </form></>;
  const matching = records.filter(row => [row.number, row.recipient, itemSummary(row)].join(' ').toLowerCase().includes(search.toLowerCase()));
  return <>
    <header className="workspace-heading"><div><h1>Delivery Challans</h1><p>Find and print delivery records for {entity.legal_name}.</p></div><Link className="workspace-primary" to={base + '/new'}><Plus size={16} /> Create challan</Link></header>
    <section className="workspace-card document-list"><label>Find a challan<input className="workspace-input" type="search" placeholder="Challan number or recipient" value={search} onChange={event => setSearch(event.target.value)} /></label>
      {matching.length ? <div className="overflow-x-auto"><table className="workspace-table"><thead><tr><th>Challan no.</th><th>Recipient</th><th>Date</th><th>Items</th><th>Action</th></tr></thead>
        <tbody>{matching.map(row => <tr key={row.id}><td>{row.number}</td><td>{row.recipient}</td><td>{row.date}</td><td>{itemSummary(row)}</td><td><Link className="workspace-control" to={base + '/' + row.id}>Open</Link></td></tr>)}</tbody></table></div>
        : <div className="empty-view"><Truck size={23} /><h2>{records.length ? 'No matches' : 'No delivery challans yet'}</h2><p>{records.length ? 'Try a different search.' : 'Create a challan when you need a printed delivery record.'}</p></div>}
    </section></>;
}

export function CustomerDetail({ entity }: { entity: Entity }) {
  const { customerId } = useParams();
  const [customer, setCustomer] = useState<Party | null>();
  const base = '/entities/' + entity.id;
  useEffect(() => {
    let current = true;
    void apiRequest('/api/v1' + base + '/customers/' + customerId)
      .then(async response => response.ok ? await response.json() as Party : null)
      .then(value => { if (current) setCustomer(value); }, () => { if (current) setCustomer(null); });
    return () => { current = false; };
  }, [base, customerId]);
  if (customer === undefined) return <p role="status">Loading customer…</p>;
  if (!customer) return <section className="workspace-card"><h1>Customer unavailable</h1><Link className="workspace-control workspace-back" to={base + '/customers'}><ArrowLeft size={16} aria-hidden="true" />Back to Customers</Link></section>;
  const bills = readBills().filter(bill => bill.seller.id === entity.id && bill.customer.id === customer.id);
  return <>
    <header className="workspace-heading"><div><Link className="workspace-control workspace-back" to={base + '/customers'}><ArrowLeft size={16} aria-hidden="true" />Back to Customers</Link><h1>{customer.legal_name}</h1><p>{entity.legal_name}</p></div><Link className="workspace-primary" to={base + '/invoices/new?customer=' + customer.id}>Create a bill</Link></header>
    <section className="workspace-card"><h2>Customer details</h2><p>{Object.values(customer.billing_address ?? {}).join(', ') || 'No billing address saved.'}</p>{customer.gstin && <p>GSTIN {customer.gstin}</p>}</section>
    <section className="workspace-card"><h2>Billing history</h2>{bills.length ? <div className="prototype-dashboard-links">{bills.map(bill => <Link key={bill.id} to={base + '/invoices/' + bill.id}>{bill.number || 'Draft'} · {bill.date} · {money(billTotal(bill))} · {bill.status}</Link>)}</div> : <p>No bills for this customer yet.</p>}</section>
  </>;
}

const reports = [
  ['billing', 'Billing register', 'Bill numbers, customers, dates and totals'],
  ['collections', 'Collection register', 'Payments and how they were received'],
  ['outstanding', 'Outstanding report', 'Unpaid balances and due dates'],
  ['customers', 'Customer-wise billing', 'Billing totals grouped by customer'],
  ['monthly', 'Monthly billing trend', 'Billing totals grouped by month'],
  ['print-type', 'Print type billing', 'Billing totals grouped by printing method'],
  ['challans', 'Delivery challan register', 'Recipients, items and delivery dates'],
  ['cancelled', 'Cancelled invoice register', 'Cancelled bills and their reasons'],
  ['companies', 'Company comparison', 'Billing totals by company'],
] as const;

export function Reports({ entity, entities }: { entity: Entity; entities: Entity[] }) {
  const { reportId } = useParams();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const base = '/entities/' + entity.id;
  const chosen = reports.find(([id]) => id === reportId);
  if (!chosen) return <Dashboard entities={entities} selected={entity} reports><section className="analytics-reports"><h2>Detailed reports</h2>
    
    <section className="prototype-company-grid">{reports.map(([id, title, description]) => <article className="workspace-card" key={id}><FileText size={20} /><h2 className="mt-3">{title}</h2><p>{description}</p><Link className="workspace-control mt-4" to={base + '/reports/' + id}>Open report</Link></article>)}</section>
  </section></Dashboard>;
  if(!mockMode) return <DatabaseReport entity={entity} entities={entities} type={chosen[0]} title={chosen[1]} />;
  const inRange = (date: string) => (!from || date >= from) && (!to || date <= to);
  const bills = readBills().filter(bill => reportId === 'companies' ? entities.some(company => company.id === bill.seller.id) : bill.seller.id === entity.id);
  const issued = bills.filter(bill => bill.status === 'Issued' && inRange(bill.date));
  let heading = ['Bill', 'Customer', 'Date', 'Amount'];
  let rows: string[][] = [];
  if (reportId === 'challans') {
    heading = ['Challan', 'Recipient', 'Date', 'Items'];
    rows = challans().filter(row => row.entityId === entity.id && inRange(row.date)).map(row => [row.number, row.recipient, row.date, itemSummary(row)]);
  } else if (reportId === 'collections') {
    heading = ['Bill', 'Date', 'Method', 'Amount'];
    rows = bills.flatMap(bill => bill.receipts.filter(row => row.status!=='reversed' && inRange(row.date)).map(row => [bill.number ?? '—', row.date, row.method, money(row.cents)]));
  } else if (reportId === 'cancelled') {
    heading = ['Bill', 'Customer', 'Cancelled on', 'Reason'];
    rows = bills.filter(bill => bill.cancellation && inRange(bill.cancellation.date)).map(bill => [bill.number ?? '—', bill.customer.legal_name, bill.cancellation!.date, bill.cancellation!.reason]);
  } else if (reportId === 'customers' || reportId === 'monthly' || reportId === 'print-type' || reportId === 'companies') {
    const grouped = new Map<string, number>();
    const add = (key: string, amount: number) => grouped.set(key, (grouped.get(key) ?? 0) + amount);
    issued.forEach(bill => {
      if (reportId === 'print-type') bill.lines.forEach(line => add(line.printType || 'Unspecified', lineAmount(line)));
      else add(reportId === 'monthly' ? bill.date.slice(0, 7) : reportId === 'customers' ? bill.customer.legal_name : bill.seller.legal_name, billTotal(bill));
    });
    heading = [reportId === 'customers' ? 'Customer' : reportId === 'monthly' ? 'Month' : reportId === 'print-type' ? 'Print type' : 'Company', 'Total'];
    rows = [...grouped].map(([label, amount]) => [label, money(amount)]);
  } else {
    const outstanding = reportId === 'outstanding';
    if (outstanding) heading = ['Bill', 'Customer', 'Due date', 'Outstanding'];
    rows = issued.filter(bill => !outstanding || billTotal(bill) > received(bill)).map(bill =>
      [bill.number ?? '—', bill.customer.legal_name, outstanding ? bill.due : bill.date, money(billTotal(bill) - (outstanding ? received(bill) : 0))]);
  }
  return <>
    <header className="workspace-heading invoice-screen"><div><Link to={base + '/reports'}>All reports</Link><h1>{chosen[1]}</h1><p>{chosen[2]}</p></div>
      <button className="workspace-primary" onClick={() => window.print()}><Printer size={16} /> Print / Save PDF</button></header>
    <section className="workspace-card workspace-form invoice-screen"><label>From date<input type="date" value={from} onChange={event => setFrom(event.target.value)} /></label><label>To date<input type="date" value={to} onChange={event => setTo(event.target.value)} /></label></section>
    <article className="workspace-card invoice-print-sheet"><h2>{chosen[1]}</h2><p>{reportId === 'companies' ? 'All active companies' : entity.legal_name} · {from || 'All dates'}{to ? ' to ' + to : ''} · Mock workspace</p>
      {rows.length ? <div className="overflow-x-auto"><table className="workspace-table"><thead><tr>{heading.map(title => <th key={title}>{title}</th>)}</tr></thead><tbody>{rows.map((row, i) => <tr key={i}>{row.map((value, j) => <td key={j}>{value}</td>)}</tr>)}</tbody></table></div> : <p className="mt-4">No records match this report.</p>}
    </article>
  </>;
}

function DatabaseReport({entity,entities,type,title}:{entity:Entity;entities:Entity[];type:string;title:string}) {
  const [from,setFrom]=useState(today().slice(0,7)+'-01');
  const [asOf,setAsOf]=useState(today());
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const pendingExport=useRef({key:'',id:''});
  const ids=type==='companies'?entities.map(row=>row.id):[entity.id];
  const valid=from.length===10 && asOf.length===10 && from<=asOf;
  const report=useQuery({queryKey:['report',type,ids.join(','),from,asOf],enabled:valid,
    queryFn:()=>requestJson<{headers:string[];rows:(string|number)[][];recordedThrough:string;timezone:string}>(
      `/api/v1/reports/${type}?entities=${ids.join(',')}&from=${from}&asOf=${asOf}`)});
  async function exportFile(format:'pdf'|'csv') {
    setBusy(true);setError('');
    try {
      const key=JSON.stringify({type,ids,from,asOf,format});
      if(pendingExport.current.key!==key) {
        const job=await requestJson<{id:string}>(`/api/v1/reports/${type}/exports`,{method:'POST',body:JSON.stringify({entities:ids,from,asOf,format})});
        pendingExport.current={key,id:job.id};
      }
      const response=await apiRequest('/api/v1/exports/'+pendingExport.current.id);
      if(!response.ok)throw new Error((await response.json()).error);
      const url=URL.createObjectURL(await response.blob());const link=document.createElement('a');link.href=url;link.download=type+'.'+format;link.click();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
    } catch(err) {setError(err instanceof Error?err.message:'Export failed.');}
    finally {setBusy(false);}
  }
  return <>
    <header className="workspace-heading invoice-screen"><div><Link to={'/entities/'+entity.id+'/reports'}>All reports</Link><h1>{title}</h1></div>
      <button className="workspace-control" onClick={()=>window.print()}>Print</button>
      <button className="workspace-primary" disabled={busy||!valid} onClick={()=>void exportFile('pdf')}>Download PDF</button>
      <button className="workspace-control" disabled={busy||!valid} onClick={()=>void exportFile('csv')}>Download CSV</button>
    </header>
    <section className="workspace-card workspace-form invoice-screen"><label>From date<input type="date" value={from} onChange={event=>setFrom(event.target.value)} /></label>
      <label>As of date<input type="date" value={asOf} onChange={event=>setAsOf(event.target.value)} /></label></section>
    {error && <p role="alert">{error}</p>}
    {!valid?<p role="alert">Choose a valid date range.</p>:report.isPending?<p role="status">Loading report…</p>:report.isError?<p role="alert">{report.error.message}</p>:
      <article className="workspace-card invoice-print-sheet"><h2>{title}</h2><p>{type==='companies'?'All companies':entity.legal_name} · {from} to {asOf}</p>
        <p>Recorded through {report.data.recordedThrough} · {report.data.timezone}</p>
        <div className="overflow-x-auto"><table className="workspace-table"><thead><tr>{report.data.headers.map(label=><th key={label}>{label}</th>)}</tr></thead>
          <tbody>{report.data.rows.map((row,i)=><tr key={i}>{row.map((value,j)=><td key={j}>{typeof value==='number'?money(Math.round(value*100)):value}</td>)}</tr>)}</tbody></table></div>
        {!report.data.rows.length && <p>No records match this report.</p>}
      </article>}
  </>;
}

export function CompanySettings({ entity }: { entity: Entity }) {
  const queryClient=useQueryClient();
  const catalog=useCatalog(entity.id);
  const preview = readBills().find(bill => bill.seller.id === entity.id);
  const settingsKey = 'thogai-bill-accent-' + entity.id;
  const [accent, setAccent] = useState(() => localStorage.getItem(settingsKey) ?? '#7c3bd1');
  const [message, setMessage] = useState('');
  const [busy,setBusy]=useState(false);
  const [kind,setKind]=useState<'invoice'|'delivery_challan'>('invoice');
  const [preset,setPreset]=useState('structured');
  async function uploadAsset(kind:'logo'|'signature',file?:File) {
    if(!file)return;
    if(file.size>512*1024){setMessage('Choose an image smaller than 512 KB.');return;}
    setBusy(true);
    try {
      const base64=await new Promise<string>((resolve,reject)=>{
        const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error('Could not read image.'));reader.readAsDataURL(file);
      });
      await requestJson('/api/v1/entities/'+entity.id+'/assets',{method:'POST',body:JSON.stringify({kind,base64})});
      await queryClient.invalidateQueries({queryKey:['directory']});setMessage('Company '+kind+' uploaded.');
    } catch(err){setMessage(err instanceof Error?err.message:'Could not upload image.');}
    finally{setBusy(false);}
  }
  useEffect(()=>{
    if(mockMode) return;
    const template=catalog.data?.document_templates.find(row=>row.id===(kind==='invoice'?entity.default_invoice_template_id:entity.default_dc_template_id));
    if(template) {setAccent(template.settings_json.accent ?? '#7c3bd1');setPreset(template.settings_json.preset ?? 'structured');}
  },[catalog.data,entity.default_invoice_template_id,entity.default_dc_template_id,kind]);
  const example: Bill = preview ?? { id: '', seller: entity, customer: { id: '', legal_name: 'Sample customer' }, date: today(), due: today(), reference: '', notes: '', status: 'Draft', receipts: [],
    lines: [{ id: 1, description: 'Garment printing', quantity: '10', rate: '150' }] };
  return <>
    <header className="workspace-heading"><div><h1>Company Settings</h1><p>Billing identity and print layout for {entity.legal_name}.</p></div><Link className="workspace-control" to="/entities">Manage companies</Link></header>
    <div className="document-detail settings-preview">
      <section className="workspace-card detail-panel"><h2>Invoice template</h2><p>A4 portrait · Company and customer details · Item totals</p>
        {!mockMode && <><label>Company logo<input type="file" accept="image/png,image/jpeg" disabled={busy} onChange={event=>void uploadAsset('logo',event.target.files?.[0])} /></label>
          <label>Authorized signature<input type="file" accept="image/png,image/jpeg" disabled={busy} onChange={event=>void uploadAsset('signature',event.target.files?.[0])} /></label></>}
        {!mockMode && <><label>Document type<Dropdown value={kind} onChange={event=>setKind(event.target.value as typeof kind)}><option value="invoice">Invoice</option><option value="delivery_challan">Delivery challan</option></Dropdown></label>
          <label>Preset<Dropdown value={preset} onChange={event=>setPreset(event.target.value)}><option value="structured">Structured</option><option value="minimal">Minimal</option></Dropdown></label></>}
        <label>Accent color<input className="workspace-input" type="color" value={accent} onChange={event => { setAccent(event.target.value); setMessage(''); }} /></label>
        <button className="workspace-primary" disabled={busy} onClick={async () => {
          setBusy(true);
          try {
            if(mockMode) {localStorage.setItem(settingsKey, accent);setMessage('Template saved in this browser.');}
            else {await requestJson('/api/v1/entities/'+entity.id+'/templates',{method:'POST',body:JSON.stringify({type:kind,settings:{accent,preset}})});await queryClient.invalidateQueries({queryKey:['directory']});await catalog.refetch();setMessage('New template version published.');}
          }
          catch(err) { setMessage(err instanceof Error?err.message:'Could not save the template.'); }
          finally {setBusy(false);}
        }}>Save template</button>{message && <p role="status">{message}</p>}</section>
      <BillPaper bill={{ ...example, accent, templatePreset:preset }} />
    </div>
  </>;
}





