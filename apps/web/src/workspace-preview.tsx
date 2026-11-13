import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CalendarDays, CircleDollarSign, Clock3, FileText, Plus, Wallet } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export type PreviewPage = 'dashboard' | 'invoices' | 'create' | 'template' | 'reports' | 'settings';
const companies = ['Alpha Solutions Pvt. Ltd.', 'Veera Tech Services'];
const money = (amount: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount);
const invoices = [
  ['ALP-INV-0248', 0, 'Sri Kumaran Foods', '20 Dec 2024', 125000, 'Pending'],
  ['VTS-INV-0119', 1, 'Anand Textiles', '18 Dec 2024', 85000, 'Paid'],
  ['ALP-INV-0247', 0, 'Velan Exports', '15 Dec 2024', 210000, 'Paid'],
  ['VTS-INV-0118', 1, 'Marutham Traders', '12 Dec 2024', 75000, 'Pending'],
] as const;

function InvoiceTable({ rows }: { rows: readonly (typeof invoices)[number][] }) {
  return <div className="overflow-x-auto"><table className="workspace-table"><thead><tr>
    {['Invoice No.', 'Company', 'Customer', 'Date', 'Amount', 'Status'].map(label => <th key={label}>{label}</th>)}
  </tr></thead><tbody>{rows.map(([number, company, customer, date, amount, status]) =>
    <tr key={number}><td><strong>{number}</strong></td><td><span className={'company-dot company-' + company} />{companies[company]}</td>
      <td>{customer}</td><td>{date}</td><td>{money(amount)}</td><td><span className={'workspace-badge ' + status.toLowerCase()}>{status}</span></td></tr>
  )}</tbody></table>{rows.length === 0 && <p className="p-4 text-sm">No invoices match your filters.</p>}</div>;
}

function Dashboard({ report = false }: { report?: boolean }) {
  const [company, setCompany] = useState(-1);
  const [months, setMonths] = useState(6);
  const [metric, setMetric] = useState<'amount' | 'count'>('amount');
  const share = company < 0 ? 1 : company === 0 ? .609 : .391;
  const periodShare = months === 6 ? 1 : .56;
  const gross = Math.round(2875000 * share * periodShare);
  const collected = Math.round(2210000 * share * periodShare);
  const trend = ['Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].map((month, index) => ({
    month, amount: [14, 19, 29, 30, 39, 46][index] * share, count: Math.round([11, 14, 21, 22, 26, 30][index] * share),
  })).slice(-months);
  const cards = [
    { label: 'Gross Billing Amount', value: money(gross), icon: Wallet, color: 'purple' },
    { label: 'Collected Amount', value: money(collected), icon: CircleDollarSign, color: 'green' },
    { label: 'Outstanding Amount', value: money(gross - collected), icon: Clock3, color: 'red' },
    { label: 'Total Invoices', value: Math.round(124 * share * periodShare), icon: FileText, color: 'purple' },
  ];
  return <>
    <div className="workspace-heading"><div><p className="workspace-kicker">Sample dashboard</p><h1>{report ? 'Billing reports' : 'Billing overview'}</h1><p>Track billing, collections, and outstanding balances across your companies.</p></div>
      <label className="workspace-control"><CalendarDays size={16} /><select aria-label="Billing period" value={months} onChange={event => setMonths(Number(event.target.value))}><option value={6}>Last 6 months</option><option value={3}>Last 3 months</option></select></label>
    </div>
    <div className="workspace-pills" aria-label="Companies">
      {['All Companies', ...companies].map((label, index) => <button key={label} aria-pressed={company === index - 1} onClick={() => setCompany(index - 1)}>{index > 0 && <span className={'company-dot company-' + (index - 1)} />}{label}</button>)}
    </div>
    <div className="workspace-metrics">{cards.map(({ label, value, icon: Icon, color }) =>
      <article className="workspace-card metric" key={label}><span className={'metric-icon ' + color}><Icon size={19} /></span><div><p>{label}</p><strong>{value}</strong></div></article>
    )}</div>
    <div className="workspace-charts">
      <section className="workspace-card"><div className="workspace-heading"><div><h2>Billing Trend</h2><p>Gross billing over time</p></div><div className="workspace-switch">
        <button aria-pressed={metric === 'amount'} onClick={() => setMetric('amount')}>Amount</button><button aria-pressed={metric === 'count'} onClick={() => setMetric('count')}>Invoices</button>
      </div></div><div className="h-48 min-w-0"><ResponsiveContainer width="100%" height="100%"><AreaChart data={trend} margin={{ top: 10, right: 10, bottom: 0, left: -12 }}>
        <CartesianGrid vertical={false} stroke="#e4dfed" /><XAxis dataKey="month" tickLine={false} axisLine={false} fontSize={11} /><YAxis tickLine={false} axisLine={false} fontSize={11} /><Tooltip /><Area dataKey={metric} type="monotone" stroke="#783cf5" fill="#dfd1fb" strokeWidth={2} />
      </AreaChart></ResponsiveContainer></div></section>
      <section className="workspace-card"><h2>Billing by Company</h2><p>Gross billing in the selected period</p><div className="workspace-breakdown">
        <div className={'workspace-donut donut-' + company}><div><strong>{money(gross)}</strong><span>Total</span></div></div>
        <ul>{companies.map((name, index) => (company < 0 || company === index) && <li key={name}><span className={'company-dot company-' + index} /><div><strong>{name}</strong><br />{money(company < 0 ? Math.round(gross * (index === 0 ? .609 : .391)) : gross)}</div></li>)}</ul>
      </div></section>
    </div>
    <div className="workspace-lower">
      <section className="workspace-card"><div className="workspace-heading"><h2>Top Customers</h2><Link to="/customers">View all →</Link></div>
        <table className="workspace-table"><thead><tr><th>Customer</th><th>Billed</th><th>Outstanding</th></tr></thead><tbody>
          {([['Sri Kumaran Foods', 650000, 120000, 0], ['Anand Textiles', 475000, 75000, 1], ['Velan Exports', 390000, 110000, 0]] as const).filter(row => company < 0 || row[3] === company).map(([name, billed, due]) => <tr key={name}><td>{name}</td><td>{money(billed * periodShare)}</td><td>{money(due * periodShare)}</td></tr>)}
        </tbody></table></section>
      <section className="workspace-card"><div className="workspace-heading"><h2>Recent Invoices</h2><Link to="/invoices">View all →</Link></div><InvoiceTable rows={invoices.filter(row => company < 0 || row[1] === company).slice(0, 3)} /></section>
    </div>
  </>;
}

function InvoiceList() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [company, setCompany] = useState('');
  return <><div className="workspace-heading"><div><p className="workspace-kicker">Sample invoices</p><h1>Invoices</h1><p>Manage and track your invoices.</p></div><Link className="workspace-primary" to="/invoices/new"><Plus size={16} /> Create Invoice</Link></div>
    <section className="workspace-card"><div className="workspace-filters">
      <select aria-label="Company" value={company} onChange={event => setCompany(event.target.value)}><option value="">All Companies</option>{companies.map((name, index) => <option key={name} value={index}>{name}</option>)}</select>
      <select aria-label="Status" value={status} onChange={event => setStatus(event.target.value)}><option value="">All Statuses</option><option>Paid</option><option>Pending</option></select>
      <input aria-label="Search invoices" placeholder="Search invoices…" value={search} onChange={event => setSearch(event.target.value)} />
    </div><InvoiceTable rows={invoices.filter(row => (!company || String(row[1]) === company) && (!status || row[5] === status) && (row[0] + ' ' + row[2]).toLowerCase().includes(search.toLowerCase()))} /></section></>;
}

function Template() {
  const [params] = useSearchParams();
  const selectedCompany = params.get('company');
  const options = selectedCompany ? [...new Set([selectedCompany, ...companies])] : companies;
  const [company, setCompany] = useState(options[0]);
  const [color, setColor] = useState('#7338dc');
  return <><div className="workspace-heading"><div><Link to="/entities">Companies /</Link><h1>Invoice Template</h1><p>Preview a company invoice and try a brand color.</p></div></div>
    <div className="workspace-template"><section className="workspace-card workspace-form"><label>Company<select value={company} onChange={event => setCompany(event.target.value)}>{options.map(name => <option key={name}>{name}</option>)}</select></label><label>Accent color<input type="color" value={color} onChange={event => setColor(event.target.value)} /></label></section>
      <article className="workspace-card workspace-paper"><div className="workspace-heading"><div><h2>{company}</h2><p>Coimbatore, Tamil Nadu</p></div><strong style={{color}}>INVOICE</strong></div><hr /><p>Bill to</p><h2>Sri Kumaran Foods</h2><p>ALP-INV-0249 · 20 Dec 2024</p><table className="workspace-table"><thead><tr><th>Description</th><th>Qty</th><th>Amount</th></tr></thead><tbody><tr><td>Web Development Services</td><td>1</td><td>{money(100000)}</td></tr></tbody></table><div className="workspace-heading mt-4" style={{color}}><strong>Total</strong><strong>{money(100000)}</strong></div></article>
    </div></>;
}

export function WorkspacePreview({ page, email }: { page: PreviewPage; email: string }) {
  switch (page) {
    case 'dashboard': return <Dashboard />;
    case 'reports': return <Dashboard report />;
    case 'invoices': return <InvoiceList />;
    case 'create': return null;
    case 'template': return <Template />;
    case 'settings': return <><div className="workspace-heading"><h1>Settings</h1></div><section className="workspace-card"><h2>Account</h2><p>Signed in as {email}</p></section></>;
  }
}


