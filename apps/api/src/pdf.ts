import { chromium } from 'playwright';

const escape = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const address = (value: Record<string,string> | undefined) => Object.values(value ?? {}).map(escape).join(', ');
const money = (cents: unknown) => new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR'}).format(Number(cents ?? 0)/100);

// Inputs are snapshots from authorized database functions. Every interpolation is escaped.
export function documentHtml(document: Record<string,any>, kind: 'invoices' | 'challans') {
  const invoice=kind==='invoices';
  const seller=document.seller ?? {};
  const minimal=(document.templatePreset ?? document.template?.settings_json?.preset)==='minimal';
  const accent= /^#[0-9a-fA-F]{6}$/.test(document.accent ?? document.template?.settings_json?.accent ?? '')
    ? document.accent ?? document.template.settings_json.accent : '#7c3bd1';
  const header=invoice ? ['No.','Style','Print type','Placement','Particulars','Qty','Rate','Amount'] : ['No.','Particulars','Quantity','Unit','Remarks'];
  const rows=(invoice ? document.lines : document.items).map((item:Record<string,any>,index:number)=>invoice
    ? [index+1,item.style,item.printType,item.placement,item.description,item.quantity,item.rate,money(item.amountCents)]
    : [index+1,item.description,item.quantity,item.unit,item.remarks]);
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page{size:A4;margin:15mm} body{font:12px Arial,sans-serif;color:#171717}h1{font-size:23px}h2{font-size:17px}
    header{border-top:${minimal?'1px':'5px'} solid ${accent};padding-top:15px}table{width:100%;border-collapse:collapse;margin:24px 0}th,td{padding:9px;border-bottom:1px solid #ddd;text-align:left}
    th{background:#f5f5f5} .summary{text-align:right} .cancelled{font-size:26px;color:#a00}p{white-space:pre-wrap}footer{margin-top:30px}
    </style></head><body><header>${seller.logo_path_data?`<img alt="Company logo" style="max-width:140px;max-height:70px" src="${escape(seller.logo_path_data)}">`:''}<h1>${escape(seller.legal_name)}</h1><p>${address(seller.billing_address)}</p>
    <p>${escape(seller.phone)} ${escape(seller.email)}</p><h2>${invoice?'LABOUR BILL':'DELIVERY CHALLAN'} ${escape(document.number)}</h2></header>
    ${document.status==='Cancelled'?'<p class="cancelled">CANCELLED</p>':''}
    <p>Date ${escape(document.date)} ${invoice?' · Due '+escape(document.due):''}</p>
    ${invoice?`<h3>Billed to ${escape(document.customer?.legal_name)}</h3><p>${address(document.customer?.billing_address)}</p><p>GSTIN ${escape(document.customer?.gstin)}</p>`
      :`<h3>Deliver to ${escape(document.recipient)}</h3><p>From ${escape(document.from)}\nTo ${escape(document.to)}</p>`}
    <table><thead><tr>${header.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map((row:unknown[])=>`<tr>${row.map(v=>`<td>${escape(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>
    ${invoice?`<div class="summary"><p>Subtotal ${money(document.subtotalCents)}\nDiscount ${money(document.discountCents)}\nTax ${money(document.taxCents)}\nRound off ${money(document.roundOffCents)}</p><h2>Grand total ${money(document.totalCents)}</h2></div>`:''}
    <footer><p>${escape(document.notes)}\n${escape(document.terms)}</p>${invoice?`<h3>Payment details</h3><p>${address(seller.bank_details)}\nUPI ${escape(seller.upi_id)}</p>`:''}
    ${seller.signature_path_data?`<img alt="Authorized signature" style="max-width:140px;max-height:60px" src="${escape(seller.signature_path_data)}">`:''}
    ${document.cancellation?`<p>Cancellation reason ${escape(document.cancellation.reason)}</p>`:''}</footer></body></html>`;
}

export async function renderPdf(html: string): Promise<Buffer> {
  const browser=await chromium.launch({headless:true});
  try {
    const page=await browser.newPage();
    await page.route('**/*',route=>route.abort());
    await page.setContent(html,{waitUntil:'load',timeout:30000});
    return await page.pdf({format:'A4',printBackground:true});
  } finally { await browser.close(); }
}

export function reportHtml(job:Record<string,any>) {
  const data=job.data_snapshot as {headers:string[];rows:unknown[][]};
  return `<!doctype html><html><head><meta charset="utf-8"><style>@page{size:A4 landscape;margin:12mm}body{font:11px Arial}table{width:100%;border-collapse:collapse}th,td{padding:8px;border-bottom:1px solid #ddd;text-align:left}</style></head><body>
    <h1>${escape(job.title_snapshot)}</h1><p>${escape(job.entity_names_snapshot.map((row:{name:string})=>row.name).join(', '))}</p>
    <p>From ${escape(job.filters_json.from)} · As of ${escape(job.as_of_date)} · Recorded through ${escape(job.recorded_through)} · ${escape(job.business_timezone)}</p>
    <p>Generated ${escape(new Date().toISOString())}</p><table><thead><tr>${data.headers.map(value=>`<th>${escape(value)}</th>`).join('')}</tr></thead>
    <tbody>${data.rows.map(row=>`<tr>${row.map(value=>`<td>${escape(value)}</td>`).join('')}</tr>`).join('')}</tbody></table></body></html>`;
}
