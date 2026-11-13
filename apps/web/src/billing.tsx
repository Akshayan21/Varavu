import { Dropdown } from './dropdown';
import { ArrowLeft, FileText, Plus, Printer } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { Entity } from './entity-selector';
import { billAmounts, billPieces, billTotal, issueBill, lineAmount, minorUnits, money, ratePattern, readBills, received, cancelBill, postReceipt, reverseReceipt, today, type Bill } from './mock-bills';
import { downloadPdf, mockMode, requestJson } from './api';
import { useQuery } from '@tanstack/react-query';

const piecesFormat = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 });

export function BillPaper({ bill }: { bill: Bill }) {
  const asset=useQuery({queryKey:['bill-assets',bill.seller.id,bill.seller.logo_path,bill.seller.signature_path],
    enabled:!mockMode && Boolean(bill.seller.logo_path || bill.seller.signature_path),staleTime:300000,
    queryFn:async()=>{
      const url=async(path?:string)=>path?(await requestJson<{url:string}>(`/api/v1/entities/${bill.seller.id}/assets/url?path=${encodeURIComponent(path)}`)).url:undefined;
      return {logo:await url(bill.seller.logo_path),signature:await url(bill.seller.signature_path)};
    }});
  const calculated = billAmounts(bill);
  const amounts = {subtotal:bill.subtotalCents ?? calculated.subtotal,discount:bill.discountCents ?? calculated.discount,
    tax:bill.taxCents ?? calculated.tax,total:bill.totalCents ?? calculated.total};
  const bank = bill.seller.bank_details;
  const paymentDetails = [['Bank', bank?.bank_name], ['Account holder', bank?.account_holder],
    ['Account no.', bank?.account_number], ['IFSC', bank?.ifsc], ['UPI', bill.seller.upi_id]].filter(([, value]) => value);

  return <article className={'invoice-print-sheet garment-paper'+(bill.templatePreset==='minimal'?' garment-minimal':'')}>
    <div className="garment-accent" style={bill.accent ? { background: bill.accent } : undefined} />
    <header className="garment-head">
      <div>{asset.data?.logo && <img src={asset.data.logo} alt="Company logo" style={{maxWidth:140,maxHeight:70}} />}<h2>{bill.seller.legal_name}</h2><p>{Object.values(bill.seller.billing_address ?? {}).join(', ')}</p>
        <p>{[bill.seller.phone, bill.seller.email].filter(Boolean).join(' · ')}</p></div>
      <div className="garment-title"><strong>LABOUR BILL</strong>
        <p className="garment-bill-number">Bill no. {bill.number || '—'}</p>{bill.status === 'Cancelled' && <span>CANCELLED BILL</span>}</div>
    </header>
    <div className="garment-parties">
      <div><h3>Billed to</h3><strong>{bill.customer.legal_name}</strong>
        <p>{Object.values(bill.customer.billing_address ?? {}).join(', ')}</p>
        {bill.customer.gstin && <p>GSTIN {bill.customer.gstin}</p>}{bill.customer.phone && <p>Phone {bill.customer.phone}</p>}</div>
      <div><h3>Billing information</h3><p>Bill date {bill.date || '—'}</p><p>Due date {bill.due || '—'}</p>
        {bill.reference && <p>Reference {bill.reference}</p>}{bill.seller.gstin && <p>Seller GSTIN {bill.seller.gstin}</p>}
        {bill.seller.pan && <p>Seller PAN {bill.seller.pan}</p>}</div>
    </div>
    <div className="garment-table-wrap"><table className="garment-table invoice-print-table">
      <thead><tr><th>No.</th><th>Service / style</th><th>Print type</th><th>Placement</th><th>Particulars</th><th>Qty (pcs)</th><th>Rate / piece</th><th>Amount</th></tr></thead>
      <tbody>{bill.lines.map((line, index) => <tr key={line.id}>
        <td>{index + 1}</td><td>{line.style || '—'}</td><td>{line.printType || '—'}</td><td>{line.placement || '—'}</td><td>{line.description || '—'}</td>
        <td>{line.quantity || '—'}</td><td>{ratePattern.test(line.rate) ? money(minorUnits(line.rate, 2)) : '—'}</td><td>{money(line.amountCents ?? lineAmount(line))}</td>
      </tr>)}</tbody>
    </table></div>
    <dl className="garment-totals">
      <div className="pieces-total"><dt>Total pieces</dt><dd>{piecesFormat.format(billPieces(bill.lines))} pcs</dd></div>
      <div><dt>Subtotal</dt><dd>{money(amounts.subtotal)}</dd></div>
      {amounts.discount > 0 && <div><dt>Discount</dt><dd>−{money(amounts.discount)}</dd></div>}
      {amounts.tax > 0 && <div><dt>Tax{bill.taxBasisPoints ? ' ('+bill.taxBasisPoints/100+'%)' : ''}</dt><dd>{money(amounts.tax)}</dd></div>}
      {Boolean(bill.roundOffCents) && <div><dt>Round off</dt><dd>{money(bill.roundOffCents!)}</dd></div>}
      <div className="garment-grand"><dt>Grand total</dt><dd>{money(amounts.total)}</dd></div>
    </dl>
    <footer className="garment-footer">
      <div className="garment-parties"><div><h3>Bank / payment details</h3>
        {paymentDetails.length ? <dl>{paymentDetails.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl> : <p>—</p>}</div>
        <div><h3>Terms and notes</h3><p className="whitespace-pre-wrap">{[bill.seller.payment_instructions, bill.notes].filter(Boolean).join('\n\n') || '—'}</p></div>
      </div>
      {bill.cancellation && <p><strong>Cancellation reason:</strong> {bill.cancellation.reason}</p>}
      <div className="garment-signature"><span>{mockMode?'Thogai mock workspace · Sample billing document':'Thogai'}</span><span>{asset.data?.signature && <img src={asset.data.signature} alt="Authorized signature" style={{maxWidth:140,maxHeight:60}} />}Authorized signatory</span></div>
    </footer>
  </article>;
}

export function BillingList({ entity }: { entity: Entity }) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const base = '/entities/' + entity.id + '/invoices';
  const bills = readBills().filter(bill => bill.seller.id === entity.id);
  const results = bills.filter(bill => (!status || bill.status === status) && (!from || bill.date >= from) && (!to || bill.date <= to) &&
    [bill.customer.legal_name, bill.number ?? '', bill.reference].join(' ').toLowerCase().includes(search.trim().toLowerCase()));
  return <>
    <header className="workspace-heading"><div><h1>Billing</h1><p>Create, find, and print bills for {entity.legal_name}.</p></div>
      <Link className="workspace-primary" to={base + '/new'}><Plus size={17} /> Create Bill</Link></header>
    <div className="workspace-card document-list">
      <div className="document-filters"><label>Find a bill<input className="workspace-input" type="search" placeholder="Bill number or customer" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} /></label>
        <label>Status<Dropdown className="workspace-input" value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}><option value="">All statuses</option><option>Draft</option><option>Issued</option><option>Cancelled</option></Dropdown></label><label>From date<input className="workspace-input" type="date" value={from} onChange={e => { setFrom(e.target.value); setPage(1); }} /></label><label>To date<input className="workspace-input" type="date" value={to} onChange={e => { setTo(e.target.value); setPage(1); }} /></label></div>
      {results.length ? <div className="overflow-x-auto"><table className="workspace-table"><thead><tr><th>Bill no.</th><th>Customer</th><th>Date</th><th>Total</th><th>Received</th><th>Outstanding</th><th>Status</th><th>Action</th></tr></thead>
        <tbody>{results.slice((page - 1) * 10, page * 10).map(bill => <tr key={bill.id}>
          <td>{bill.number || 'Unnumbered'}</td><td>{bill.customer.legal_name}</td><td>{bill.date}</td><td>{money(billTotal(bill))}</td>
          <td>{bill.status === 'Issued' ? money(received(bill)) : '—'}</td><td>{bill.status === 'Issued' ? money(billTotal(bill) - received(bill)) : '—'}</td>
          <td><span className={'workspace-badge ' + (bill.status === 'Issued' ? 'paid' : bill.status === 'Cancelled' ? 'archived' : '')}>{bill.status}</span></td>
          <td><Link className="workspace-control" to={base + '/' + bill.id} aria-label={'Open ' + (bill.number || 'draft for ' + bill.customer.legal_name)}>Open</Link></td>
        </tr>)}</tbody></table></div> : <div className="empty-view"><FileText size={23} /><h2>{bills.length ? 'No bills match' : 'No saved bills'}</h2><p>{bills.length ? 'Try a different name or status.' : 'Use Create Bill to save your first draft.'}</p></div>}
      <div className="document-pagination"><p>{results.length} {results.length === 1 ? 'bill' : 'bills'}</p>
        {results.length > 10 && <><button className="workspace-control" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page}</span><button className="workspace-control" disabled={page * 10 >= results.length} onClick={() => setPage(page + 1)}>Next</button></>}
      </div>
    </div>
  </>;
}

export function BillDetail({ entity }: { entity: Entity }) {
  const { billId } = useParams();
  const navigate = useNavigate();
  const [localBill, setBill] = useState(() => readBills().find(row => row.id === billId && row.seller.id === entity.id));
  const bill=mockMode?localBill:readBills().find(row=>row.id===billId && row.seller.id===entity.id);
  const [action, setAction] = useState<'issue' | 'cancel' | 'payment' | 'reverse' | null>(null);
  const [paymentId,setPaymentId]=useState('');
  const [busy,setBusy]=useState(false);
  const paymentRequest=useRef({payload:'',key:crypto.randomUUID()});
  const [error, setError] = useState('');
  const base = '/entities/' + entity.id + '/invoices';
  if (!bill) return <section className="workspace-card"><h1>Bill unavailable</h1><Link className="workspace-control workspace-back" to={base}><ArrowLeft size={16} aria-hidden="true" />Back to Billing</Link></section>;

  const balance = billTotal(bill) - received(bill);
  async function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if(busy) return;
    const data = new FormData(event.currentTarget);
    setError('');
    try {
      const openBill = readBills().find(row => row.id === billId && row.seller.id === entity.id);
      if (!openBill) throw new Error('This bill is no longer available.');
      setBusy(true);
      if (action === 'issue') setBill(await issueBill(openBill));
      else if (openBill.status !== 'Issued') throw new Error('This action requires an issued bill.');
      if (action === 'cancel') {
        const reason = String(data.get('reason') ?? '').trim();
        if (!reason || openBill.receipts.some(row=>row.status!=='reversed')) throw new Error('Enter a reason and reverse active receipts before cancelling.');
        setBill(await cancelBill(openBill,reason));
      }
      if (action === 'payment') {
        const amount = String(data.get('amount') ?? '');
        const cents = ratePattern.test(amount) ? minorUnits(amount, 2) : 0;
        if (cents <= 0 || cents > billTotal(openBill) - received(openBill)) throw new Error('Enter an amount greater than zero and within the outstanding balance.');
        const receipt={id:crypto.randomUUID(),cents,date:String(data.get('date')),method:String(data.get('method')),reference:String(data.get('reference'))};
        const fingerprint=JSON.stringify({...receipt,id:undefined});
        if(paymentRequest.current.payload!==fingerprint) paymentRequest.current={payload:fingerprint,key:crypto.randomUUID()};
        setBill(await postReceipt(openBill,receipt,paymentRequest.current.key));
      }
      if(action==='reverse') setBill(await reverseReceipt(openBill,paymentId,String(data.get('reason') ?? '')));
      setAction(null);
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not save the change.'); }
    finally {setBusy(false);}
  }
  return <>
    <header className="workspace-heading invoice-screen"><div><Link className="workspace-control workspace-back" to={base}><ArrowLeft size={16} aria-hidden="true" />Back to Billing</Link><h1>{bill.number || 'Bill draft'}</h1><p>{bill.customer.legal_name} · {bill.status}</p></div>
      <button className="workspace-primary" onClick={() => window.print()}><Printer size={16} /> Print / Save PDF</button></header>
    {!mockMode && bill.status!=='Draft' && <button className="workspace-control" disabled={busy} onClick={()=>{
      setBusy(true);void downloadPdf(entity.id,'invoices',bill.id).catch(err=>setError(err.message)).finally(()=>setBusy(false));
    }}>Download PDF</button>}
    {error && !action && <p role="alert">{error}</p>}
    <div className="document-detail">
      <BillPaper bill={bill} />
      <aside className="workspace-card invoice-screen detail-panel"><h2>Bill actions</h2>
        <p>Total {money(billTotal(bill))}</p>
        {bill.status === 'Draft' && <><Link className="workspace-control" to={base + '/' + bill.id + '/edit'}>Edit draft</Link><button className="workspace-primary" onClick={() => { setError(''); setAction('issue'); }}>{mockMode?'Issue sample bill':'Issue bill'}</button></>}
        {bill.status === 'Issued' && <>
          <p>Outstanding {money(balance)}</p>
          <button className="workspace-control" disabled={balance <= 0} onClick={() => { setError(''); setAction('payment'); }}>Record payment</button>
          <button className="workspace-control" disabled={bill.receipts.some(row=>row.status!=='reversed')} onClick={() => { setError(''); setAction('cancel'); }}>Cancel bill</button>
          {bill.receipts.some(row=>row.status!=='reversed') && <p>Reverse active receipts before cancelling.</p>}
        </>}
        <button className="workspace-control" onClick={() => navigate(base + '/new', { state: { copy: bill } })}>Duplicate as draft</button>
        {bill.receipts.length > 0 && <><h2>Payment history</h2><ul>{bill.receipts.map(row => <li key={row.id}>{row.date} · {money(row.cents)} · {row.method}{row.reference && ' · ' + row.reference}
          {row.status==='reversed' ? ' · Reversed · '+row.reversalReason : !mockMode && <button className="workspace-control" onClick={()=>{setPaymentId(row.id);setAction('reverse');}}>Reverse receipt</button>}
        </li>)}</ul></>}
      </aside>
    </div>
    {action && <dialog ref={element => { if (element && !element.open) element.showModal(); }} className="workspace-card mock-dialog" aria-labelledby="bill-action-title" onCancel={() => setAction(null)}>
      <form onSubmit={apply} className="space-y-4">
        <h2 id="bill-action-title">{action === 'issue' ? 'Issue this bill?' : action === 'cancel' ? 'Cancel this bill?' : action==='reverse'?'Reverse this receipt?':'Record a payment'}</h2>
        {action === 'issue' && <p>The draft will get a bill number and its details will be locked.</p>}
        {(action === 'cancel' || action==='reverse') && <label>Reason<textarea className="workspace-input" name="reason" required /></label>}
        {action === 'payment' && <div className="workspace-form">
          <label>Amount (₹)<input name="amount" required inputMode="decimal" /></label><label>Date<input name="date" type="date" required defaultValue={today()} /></label>
          <label>Method<Dropdown name="method"><option>Bank transfer</option><option>UPI</option><option>Cash</option><option>Cheque</option><option>Other</option></Dropdown></label><label>Reference<input name="reference" /></label>
        </div>}
        {error && <p role="alert">{error}</p>}
        <div className="flex gap-2"><button className="workspace-primary" disabled={busy}>{busy?'Saving…':action === 'issue' ? 'Confirm issue' : action === 'cancel' ? 'Confirm cancellation' : action==='reverse'?'Confirm reversal':'Save payment'}</button><button type="button" className="workspace-control workspace-back-action" disabled={busy} onClick={() => setAction(null)}><ArrowLeft size={16} aria-hidden="true" />Go back</button></div>
      </form>
    </dialog>}
  </>;
}



