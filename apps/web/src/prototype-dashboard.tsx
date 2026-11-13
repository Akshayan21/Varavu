import { createDashboardMockData } from './dashboard-mock-data';
import { Activity, AlertTriangle, CircleX, Coins, FileText, Search, Users, Wallet } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Entity } from './entity-selector';
import { Dropdown } from './dropdown';
import { billTotal, lineAmount, money, readBills, today, billAsOf } from './mock-bills';
import { challans } from './mock-screens';
import { mockMode } from './api';
const colors = ['#7c3bd1', '#bd9aee', '#9c6ddd', '#d6c3f2', '#5e28a4'];
const compact = (value: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', notation: 'compact', maximumFractionDigits: 1 }).format(value / 100);
function defaultRange() { const end = today(); const [year, month] = end.split('-').map(Number); return { start: new Date(Date.UTC(year, month - 6, 1)).toISOString().slice(0, 10), end }; }
function Panel({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return <section className="analytics-panel"><header><h2>{title}</h2>{action}</header>{children}</section>;
}
function Donut({ data, label, total }: { data: { name: string; value: number; color: string }[]; label: string; total: string }) {
  return <div className="analytics-donut"><div className="donut-plot"><ResponsiveContainer width="100%" height={175}><PieChart><Pie data={data} dataKey="value" nameKey="name" innerRadius={53} outerRadius={78} paddingAngle={2} isAnimationActive={false}>{data.map(row => <Cell key={row.name} fill={row.color} />)}</Pie><Tooltip formatter={value => label === 'Total billing' ? money(Number(value)) : Number(value)} /></PieChart></ResponsiveContainer><div className="donut-center"><strong>{total}</strong><small>{label}</small></div></div><ul>{data.map(row => <li key={row.name}><i style={{ background: row.color }} /><span>{row.name}<strong>{label === 'Total billing' ? money(row.value) : row.value.toLocaleString('en-IN')}</strong></span></li>)}</ul></div>;
}
export function Dashboard({ entities, selected, reports = false, children }: { entities: Entity[]; selected?: Entity; reports?: boolean; children?: ReactNode }) {
  const [range, setRange] = useState(defaultRange);
  const [showMockData, setShowMockData] = useState(false);
  const preview = useMemo(() => createDashboardMockData(entities), [entities]);
  const sourceBills = !mockMode ? readBills().map(bill=>billAsOf(bill,range.end)) : selected ? readBills() : showMockData ? preview.bills : [];
  const sourceChallans = !mockMode || selected ? challans() : showMockData ? preview.challans : [];
  const [company, setCompany] = useState(''); const [search, setSearch] = useState('');
  const validRange = range.start >= '1900-01-01' && range.start <= range.end && range.end <= today();
  const inRange = (date: string) => validRange && date >= range.start && date <= range.end;
  const shown = selected ? [selected] : entities.filter(entity => !company || entity.id === company);
  const ids = new Set(shown.map(entity => entity.id));
  const bills = sourceBills.filter(bill => ids.has(bill.seller.id) && inRange(bill.date));
  const issued = bills.filter(bill => bill.status === 'Issued');
  const allIssued = sourceBills.filter(bill=>ids.has(bill.seller.id) && bill.status==='Issued' && bill.date<=range.end);
  const paid = (bill: typeof bills[number]) => bill.receipts.reduce((sum, row) => sum + (row.status!=='reversed' && row.date <= range.end ? row.cents : 0), 0);
  const balance = (bill: typeof bills[number]) => Math.max(0, billTotal(bill) - paid(bill));
  const billed = issued.reduce((sum, bill) => sum + billTotal(bill), 0);
  const collected = allIssued.flatMap(bill=>bill.receipts).filter(row=>row.status!=='reversed' && inRange(row.date)).reduce((sum,row)=>sum+row.cents,0);
  const outstanding = allIssued.reduce((sum, bill) => sum + balance(bill), 0);
  const dc = sourceChallans.filter(row => ids.has(row.entityId) && inRange(row.date));
  const metrics = [['Total Billing', money(billed), Coins, 'purple'], ['Total Collections', money(collected), Wallet, 'green'], ['Outstanding Amount', money(outstanding), AlertTriangle, 'red'], ['Total Bills', bills.length.toLocaleString('en-IN'), FileText, 'purple'], ['Cancelled Bills', bills.filter(bill => bill.status === 'Cancelled').length, CircleX, 'red'], ['Billed Customers', new Set(issued.map(bill => bill.customer.id)).size, Users, 'purple']] as const;
  const months: Record<string, string | number>[] = [];
  if (validRange) {
    const date = new Date(range.start.slice(0, 7) + '-01T00:00:00Z');
    while (date.toISOString().slice(0, 10) <= range.end) {
      const key = date.toISOString().slice(0, 7);
      const row: Record<string, string | number> = { month: date.toLocaleDateString('en-IN', { month: 'short', year: '2-digit', timeZone: 'UTC' }), billed: 0, collected: 0 };
      shown.forEach(entity => { row[entity.id] = issued.filter(bill => bill.seller.id === entity.id && bill.date.startsWith(key)).reduce((sum, bill) => sum + billTotal(bill), 0); });
      row.billed = issued.filter(bill => bill.date.startsWith(key)).reduce((sum, bill) => sum + billTotal(bill), 0);
      row.collected = sourceBills.filter(bill => bill.status === 'Issued' && ids.has(bill.seller.id)).flatMap(bill => bill.receipts).filter(receipt => receipt.status!=='reversed' && inRange(receipt.date) && receipt.date.startsWith(key)).reduce((sum, receipt) => sum + receipt.cents, 0);
      months.push(row); date.setUTCMonth(date.getUTCMonth() + 1);
    }
  }
  const share = shown.map((entity, i) => ({ name: entity.legal_name, value: issued.filter(bill => bill.seller.id === entity.id).reduce((sum, bill) => sum + billTotal(bill), 0), color: colors[i % colors.length] }));
  const status = [{ name: 'Paid', value: issued.filter(bill => balance(bill) === 0).length, color: '#48ac61' }, { name: 'Pending', value: issued.filter(bill => balance(bill) > 0 && bill.due >= range.end).length, color: '#f4bd45' }, { name: 'Overdue', value: issued.filter(bill => balance(bill) > 0 && bill.due < range.end).length, color: '#ec626c' }, { name: 'Cancelled', value: bills.filter(bill => bill.status === 'Cancelled').length, color: '#b9bdce' }, { name: 'Draft', value: bills.filter(bill => bill.status === 'Draft').length, color: '#a480da' }];
  const customers = new Map<string, { name: string; value: number }>(); const printing = new Map<string, number>();
  issued.forEach(bill => { const key = bill.seller.id + ':' + bill.customer.id; customers.set(key, { name: bill.customer.legal_name, value: (customers.get(key)?.value ?? 0) + billTotal(bill) }); bill.lines.forEach(line => printing.set(line.printType || 'Unspecified', (printing.get(line.printType || 'Unspecified') ?? 0) + lineAmount(line))); });
  const top = [...customers.values()].sort((a, b) => b.value - a.value).slice(0, 5);
  const aging = ['Not due','1–30 days', '31–60 days', '61–90 days', '91+ days'].map((name, i) => ({ name, value: allIssued.filter(bill => { const days = Math.floor((Date.parse(range.end) - Date.parse(bill.due)) / 86400000); return i===0?days<=0:i === 4 ? days > 90 : days >= (i-1)*30+1 && days <= i*30; }).reduce((sum, bill) => sum + balance(bill), 0) }));
  const matches = (text: string) => text.toLowerCase().includes(search.trim().toLowerCase());
  const recent = [...bills].filter(bill => matches((bill.number || 'Draft') + ' ' + bill.customer.legal_name + ' ' + bill.seller.legal_name)).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
  const recentDc = [...dc].filter(row => matches(row.number + ' ' + row.recipient)).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
  const alerts = allIssued.filter(bill => balance(bill) > 0 && bill.due < range.end);
  const receipts = issued.flatMap(bill => bill.receipts.filter(row => inRange(row.date)).map(receipt => ({ bill, receipt }))).sort((a, b) => b.receipt.date.localeCompare(a.receipt.date)).slice(0, 3);
  const grid = <CartesianGrid vertical={false} stroke="#eeebf5" />;
  const axis = <YAxis width={58} tickFormatter={compact} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />;
  const tooltip = <Tooltip formatter={value => money(Number(value))} />;
  const xAxis = <XAxis dataKey="month" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />;
  return <div className="analytics-dashboard">
    <header className="analytics-heading"><div><h1>{reports ? 'Reports & Analytics' : selected ? (selected.display_name || selected.legal_name) + ' dashboard' : 'Centralized Dashboard'}</h1><p>{selected ? 'Only ' + (selected.display_name || selected.legal_name) + ' · Bills, collections, customers and delivery challans.' : 'Compare billing, collections and outstanding amounts across your companies.'}</p></div>
      <div className="analytics-filters">{!selected && <Dropdown aria-label="Dashboard company" value={company} onChange={event => setCompany(event.target.value)}><option value="">All Entities</option>{entities.map(entity => <option value={entity.id} key={entity.id}>{entity.legal_name}</option>)}</Dropdown>}
      <label>From<input type="date" aria-label="From date" min="1900-01-01" max={range.end} value={range.start} onChange={event => setRange({ ...range, start: event.target.value })} /></label><label>To<input type="date" aria-label="To date" min={range.start} max={today()} value={range.end} onChange={event => setRange({ ...range, end: event.target.value })} /></label><button className="workspace-control" onClick={() => setRange(defaultRange())}>Last 6 months</button></div>
    </header>
    {mockMode && !selected && <section className="dashboard-preview-control" aria-label="Dashboard preview"><div><strong>{showMockData ? 'Sample data preview' : 'Empty dashboard preview'}</strong><p>{showMockData ? 'Illustrative bills, payments and challans for each company. Saved records are unchanged.' : 'Turn on mock data to explore a populated dashboard. Saved records are unchanged.'}</p></div><label className="dashboard-preview-switch"><input type="checkbox" role="switch" aria-label="Show mock data" checked={showMockData} onChange={event => setShowMockData(event.target.checked)} /><span aria-hidden="true" /><strong>Show mock data</strong></label></section>}
    <div className="analytics-context">{selected && !reports && <div className="flex flex-wrap gap-2"><Link className="workspace-primary" to={'/entities/' + selected.id + '/invoices/new'}>Create a bill</Link><Link className="workspace-control" to={'/entities/' + selected.id + '/customers?create=1'}>Add a customer</Link></div>}<span>{!mockMode ? 'Saved company records' : selected ? 'Mock workspace · Saved browser records' : showMockData ? 'Sample data only · Preview documents cannot be edited' : 'Empty preview · No sample records shown'}</span><label><Search size={16} /><input aria-label="Search dashboard records" placeholder="Search bills, DC, customers…" value={search} onChange={event => setSearch(event.target.value)} /></label></div>
    {!validRange ? <p role="status">Choose a valid date range between 1900 and today.</p> : <>
    <section className="analytics-metrics" aria-label="Billing totals">{metrics.map(([label, value, Icon, tone]) => <article className={'analytics-kpi ' + tone} key={label}><Icon size={23} /><div><h2>{label}</h2><strong>{value}</strong><small>Selected period</small></div></article>)}</section>
    {!selected && <Panel title="Company comparison" action={<span className="chart-note">Same date range · Separate company records</span>}><div className="overflow-x-auto"><table className="analytics-table comparison-table"><thead><tr><th>Company</th><th>Billing</th><th>Collections</th><th>Outstanding</th><th>Issued bills</th><th>Workspace</th></tr></thead><tbody>{shown.map(entity => { const rows = issued.filter(bill => bill.seller.id === entity.id); const openRows=allIssued.filter(bill=>bill.seller.id===entity.id); return <tr key={entity.id}><td><strong>{entity.display_name || entity.legal_name}</strong></td><td>{money(rows.reduce((sum, bill) => sum + billTotal(bill), 0))}</td><td>{money(rows.reduce((sum, bill) => sum + paid(bill), 0))}</td><td>{money(openRows.reduce((sum, bill) => sum + balance(bill), 0))}</td><td>{rows.length}</td><td><Link to={'/entities/' + entity.id}>Open company dashboard →</Link></td></tr>; })}</tbody></table></div></Panel>}
    <div className="analytics-grid two">
      <Panel title="Billing vs Collections"><div className="analytics-chart"><ResponsiveContainer width="100%" height="100%"><AreaChart data={months} margin={{ right: 12 }}>{grid}{xAxis}{axis}{tooltip}<Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} /><Area type="monotone" dataKey="billed" name="Billing" stroke="#7c3bd1" fill="#7c3bd1" fillOpacity={0.1} strokeWidth={2} isAnimationActive={false} /><Area type="monotone" dataKey="collected" name="Collections" stroke="#329944" fill="#329944" fillOpacity={0.08} strokeWidth={2} isAnimationActive={false} /></AreaChart></ResponsiveContainer></div><p className="chart-note">Billing by bill date; collections by payment date, including earlier bills.</p></Panel>
      <Panel title={selected ? 'Monthly Billing' : 'Entity-wise Monthly Billing'}><div className="analytics-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={months}>{grid}{xAxis}{axis}{tooltip}<Legend iconType="square" wrapperStyle={{ fontSize: 11 }} />{shown.map((entity, i) => <Bar key={entity.id} dataKey={entity.id} name={entity.display_name || entity.legal_name} fill={colors[i % colors.length]} radius={[3, 3, 0, 0]} isAnimationActive={false} />)}</BarChart></ResponsiveContainer></div></Panel>
    </div>
    <div className="analytics-grid three">
      <Panel title={selected ? 'Collections & Outstanding' : 'Billing Share by Entity'}>{billed ? <Donut data={selected ? [{ name: 'Collected', value: collected, color: '#48ac61' }, { name: 'Outstanding', value: outstanding, color: '#7c3bd1' }] : share} label="Total billing" total={compact(billed)} /> : <p className="analytics-empty">No issued bills in this period.</p>}</Panel>
      <Panel title="Bill Status Split">{bills.length ? <Donut data={status} label="Total bills" total={String(bills.length)} /> : <p className="analytics-empty">No bills in this period.</p>}</Panel>
      <Panel title="Top 5 Customers by Billed Amount"><div className="analytics-ranking">{top.map((row, i) => <div key={row.name + i}><span title={row.name}>{row.name}</span><div><i style={{ width: row.value / Math.max(1, top[0].value) * 100 + '%', background: colors[i % colors.length] }} /></div><strong>{money(row.value)}</strong></div>)}{!top.length && <p className="analytics-empty">Issue a bill to see your top customers.</p>}</div></Panel>
    </div>
    <div className="analytics-grid aging">
      <Panel title="Outstanding Aging"><div className="analytics-chart short"><ResponsiveContainer width="100%" height="100%"><BarChart data={aging}>{grid}<XAxis dataKey="name" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />{axis}{tooltip}<Bar dataKey="value" name="Outstanding" radius={[3, 3, 0, 0]} isAnimationActive={false}>{aging.map((row, i) => <Cell key={row.name} fill={['#62b774', '#f6c14e', '#f79f52', '#ed6c77'][i]} />)}</Bar></BarChart></ResponsiveContainer></div><p className="chart-note">Outstanding as of period end, grouped by days past due.</p></Panel>
      <Panel title="Printing Type Mix · Item Amount"><div className="analytics-chart short"><ResponsiveContainer width="100%" height="100%"><BarChart data={[...printing].map(([name, value]) => ({ name, value }))}>{grid}<XAxis dataKey="name" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />{axis}{tooltip}<Bar dataKey="value" name="Item amount" fill="#a47bdf" radius={[3, 3, 0, 0]} isAnimationActive={false} /></BarChart></ResponsiveContainer></div><p className="chart-note">Before bill-level discounts and tax.</p></Panel>
    </div>
    <div className="analytics-grid records">
      <Panel title="Recent Bills" action={selected && <Link to={'/entities/' + selected.id + '/invoices'}>View all →</Link>}><div className="overflow-x-auto"><table className="analytics-table"><thead><tr><th>Bill No.</th><th>Customer</th><th>Amount</th><th>Status</th></tr></thead><tbody>{recent.map(bill => <tr key={bill.id}><td>{selected ? <Link to={'/entities/' + bill.seller.id + '/invoices/' + bill.id}>{bill.number || 'Draft'}</Link> : <span className="preview-document-number">{bill.number || 'Draft'}</span>}<small>{bill.seller.display_name || bill.seller.legal_name}</small></td><td>{bill.customer.legal_name}</td><td>{money(billTotal(bill))}</td><td><span className={'analytics-status ' + (bill.status === 'Issued' ? balance(bill) === 0 ? 'paid' : bill.due < range.end ? 'overdue' : 'pending' : '')}>{bill.status === 'Issued' ? balance(bill) === 0 ? 'Paid' : bill.due < range.end ? 'Overdue' : 'Pending' : bill.status}</span></td></tr>)}</tbody></table>{!recent.length && <p className="analytics-empty">No bills match these filters.</p>}</div></Panel>
      <Panel title="Recent Delivery Challans" action={selected && <Link to={'/entities/' + selected.id + '/challans'}>View all →</Link>}><div className="overflow-x-auto"><table className="analytics-table"><thead><tr><th>DC No.</th><th>Customer</th><th>Dispatch date</th></tr></thead><tbody>{recentDc.map(row => <tr key={row.id}><td>{selected ? <Link to={'/entities/' + row.entityId + '/challans/' + row.id}>{row.number}</Link> : <span className="preview-document-number">{row.number}</span>}</td><td>{row.recipient}</td><td>{row.date}</td></tr>)}</tbody></table>{!recentDc.length && <p className="analytics-empty">No challans match these filters.</p>}</div></Panel>
      <Panel title="Recent Activity / Alerts"><ul className="analytics-activity"><li><AlertTriangle size={20} /><div><strong>Overdue bills</strong><p>{alerts.length} bills · {money(alerts.reduce((sum, bill) => sum + balance(bill), 0))} to follow up.</p></div></li>{receipts.map(({ bill, receipt }) => <li key={bill.id + receipt.id}><Wallet size={20} /><div><strong>Payment received</strong><p>{money(receipt.cents)} from {bill.customer.legal_name}</p><small>{receipt.date}</small></div></li>)}{!receipts.length && <li><Activity size={20} /><p>No payments recorded in this period.</p></li>}</ul></Panel>
    </div><p className="analytics-footnote">Totals include issued bills; status counts also include drafts and cancelled bills. Collections use receipt dates. Outstanding includes earlier unpaid bills.</p>
    </>}{children}
  </div>;
}
