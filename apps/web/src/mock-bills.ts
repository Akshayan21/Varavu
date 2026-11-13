import type { Entity } from './entity-selector';
import { mockMode, requestJson } from './api';
import { cachedBills, cacheBill } from './document-cache';

export type Party = {
  id: string; legal_name: string; gstin?: string; billing_address?: Record<string, string>;
  payment_terms_days?: number; phone?: string;
};
export type BillLine = {
  id: number; description: string; quantity: string; rate: string;
  style?: string; printType?: string; placement?: string;
  styleId?: string | null; databaseId?: string; amountCents?: number; taxableCents?: number; taxCents?: number;
};
export type Receipt = { id: string; date: string; cents: number; method: string; reference: string; status?: 'posted' | 'reversed'; reversalReason?: string;reversedAt?:string };
export type Bill = {
  id: string; seller: Entity; customer: Party; date: string; due: string; reference: string; notes: string;
  lines: BillLine[]; discountCents?: number; taxBasisPoints?: number; accent?: string; status: 'Draft' | 'Issued' | 'Cancelled'; number?: string; cancellation?: { date: string; reason: string };
  receipts: Receipt[];
  version?: number; totalCents?: number; subtotalCents?: number; taxCents?: number; taxableCents?: number; roundOffCents?: number;
  issuedAt?:string;cancelledAt?:string;templatePreset?:string;
};

export const quantityPattern = /^\d{1,6}(?:\.\d{1,3})?$/;
export const ratePattern = /^\d{1,8}(?:\.\d{1,2})?$/;
const currency = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });
export const money = (cents: number) => currency.format(cents / 100);
export const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

export function minorUnits(value: string, digits: number) {
  const [whole, fraction = ''] = value.split('.');
  return Number(whole) * 10 ** digits + Number(fraction.padEnd(digits, '0'));
}
export function lineAmount(line: BillLine) {
  if (!quantityPattern.test(line.quantity) || !ratePattern.test(line.rate)) return 0;
  const amount = BigInt(minorUnits(line.quantity, 3)) * BigInt(minorUnits(line.rate, 2));
  return Number((amount + 500n) / 1000n);
}
export const billSubtotal = (lines: BillLine[]) => lines.reduce((sum, line) => sum + lineAmount(line), 0);
export const billPieces = (lines: BillLine[]) => lines.reduce((sum, line) =>
  sum + (quantityPattern.test(line.quantity) ? minorUnits(line.quantity, 3) : 0), 0) / 1000;
export function billAmounts(bill: Pick<Bill, 'lines' | 'discountCents' | 'taxBasisPoints'>) {
  const subtotal = billSubtotal(bill.lines);
  const discount = Math.min(subtotal, bill.discountCents ?? 0);
  const taxable = subtotal - discount;
  const tax = Number((BigInt(taxable) * BigInt(bill.taxBasisPoints ?? 0) + 5000n) / 10000n);
  return { subtotal, discount, tax, total: taxable + tax };
}
export const billTotal = (bill: Bill) => bill.totalCents ?? billAmounts(bill).total;
export const received = (bill: Bill) => bill.receipts.filter(row=>row.status!=='reversed').reduce((sum, receipt) => sum + receipt.cents, 0);

export function billAsOf(bill:Bill,date:string):Bill {
  const localDate=(timestamp:string)=>new Date(timestamp).toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'});
  return {...bill,status:bill.status==='Cancelled' && bill.cancelledAt && localDate(bill.cancelledAt)>date?'Issued':bill.status,
    receipts:bill.receipts.map(row=>row.status==='reversed' && row.reversedAt && localDate(row.reversedAt)>date?{...row,status:'posted'}:row)};
}

const seeded: Bill[] = [
  ['460e73a5-5733-41df-bcd0-f87134395c01', 'Alpha Solutions Pvt. Ltd.', 'ALP', '460e73a5-5733-41df-bcd0-f87134395c03', 'Sri Kumaran Foods'],
  ['460e73a5-5733-41df-bcd0-f87134395c02', 'Veera Tech Services', 'VTS', '460e73a5-5733-41df-bcd0-f87134395c04', 'Anand Textiles'],
].map(([id, company, code, customerId, customer], index) => ({
  id: 'sample-bill-' + (index + 1), seller: { id, legal_name: company, entity_code: code },
  customer: { id: customerId, legal_name: customer }, date: '2026-11-05', due: '2026-12-05',
  reference: '', notes: 'Sample bill for exploring the workspace.',
  lines: [{ id: 1, description: 'Garment printing', quantity: '100', rate: index ? '120' : '150', printType: 'Screen Printing' }],
  status: 'Issued', number: code + '-0001', receipts: [],
}));

const storageKey = 'thogai-mock-bills-v1';
export function readBills(): Bill[] {
  if (!mockMode) return cachedBills();
  const raw = localStorage.getItem(storageKey);
  if (!raw) return structuredClone(seeded);
  return JSON.parse(raw) as Bill[];
}

export async function saveBill(bill: Bill): Promise<Bill> {
  if (!mockMode) {
    const saved=await requestJson<Bill>('/api/v1/entities/'+bill.seller.id+'/invoices',{
      method:'POST',body:JSON.stringify({id:bill.id,version:bill.version,customerId:bill.customer.id,
        date:bill.date,due:bill.due,reference:bill.reference,notes:bill.notes,
        bank:bill.seller.bank_details,upi:bill.seller.upi_id,discountCents:bill.discountCents ?? 0,
        taxBasisPoints:bill.taxBasisPoints ?? 0,
        lines:bill.lines.map(({id,description,quantity,rate,style,styleId,printType,placement})=>
          ({id,description,quantity,rate,style:style ?? undefined,styleId,printType:printType ?? undefined,placement:placement ?? undefined}))}),
    });
    cacheBill(saved);
    return saved;
  }
  const bills = readBills();
  const existing = bills.find(row => row.id === bill.id);
  if (existing && existing.seller.id !== bill.seller.id) throw new Error('This bill belongs to another company.');
  if (existing && existing.status !== 'Draft' && bill.status === 'Draft') throw new Error('This draft has already been issued.');
  const next = bills.filter(row => row.id !== bill.id);
  next.unshift(bill);
  localStorage.setItem(storageKey, JSON.stringify(next));
  return bill;
}

export async function issueBill(bill: Bill) {
  if (!mockMode) {
    const saved=await requestJson<Bill>(`/api/v1/entities/${bill.seller.id}/invoices/${bill.id}/issue`,{
      method:'POST',body:JSON.stringify({version:bill.version}),
    });
    cacheBill(saved);
    return saved;
  }
  const bills = readBills().filter(row => row.seller.id === bill.seller.id);
  const current = bills.find(row => row.id === bill.id);
  if (current?.status !== 'Draft') throw new Error('Only a saved draft can be issued.');
  const sequence = Math.max(0, ...bills.map(row => Number(row.number?.match(/\d+$/)?.[0] ?? 0))) + 1;
  return saveBill({ ...current, status: 'Issued',
    number: (current.seller.invoice_prefix?.trim() || current.seller.entity_code) + '-' + String(sequence).padStart(4, '0') });
}

export async function cancelBill(bill:Bill,reason:string) {
  if(mockMode) return saveBill({...bill,status:'Cancelled',cancellation:{date:today(),reason}});
  const saved=await requestJson<Bill>(`/api/v1/entities/${bill.seller.id}/invoices/${bill.id}/cancel`,{method:'POST',body:JSON.stringify({reason})});
  cacheBill(saved);
  return saved;
}

export async function postReceipt(bill:Bill,receipt:Receipt,key:string) {
  if(mockMode) return saveBill({...bill,receipts:[...bill.receipts,receipt]});
  const methods:Record<string,string>={'Bank transfer':'bank_transfer','UPI':'upi','Cash':'cash','Cheque':'cheque','Other':'other'};
  const saved=await requestJson<Bill>(`/api/v1/entities/${bill.seller.id}/invoices/${bill.id}/payments`,{
    method:'POST',headers:{'Idempotency-Key':key},body:JSON.stringify({date:receipt.date,cents:receipt.cents,method:methods[receipt.method] ?? receipt.method,reference:receipt.reference}),
  });
  cacheBill(saved);
  return saved;
}

export async function reverseReceipt(bill:Bill,paymentId:string,reason:string) {
  const saved=await requestJson<Bill>(`/api/v1/entities/${bill.seller.id}/invoices/${bill.id}/payments/${paymentId}/reverse`,{method:'POST',body:JSON.stringify({reason})});
  cacheBill(saved);
  return saved;
}



