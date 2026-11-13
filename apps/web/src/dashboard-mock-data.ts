import type { Entity } from './entity-selector';
import { billTotal, today, type Bill } from './mock-bills';
import type { Challan } from './mock-screens';

// Isolated dashboard fixtures. Never written to the bill, customer or challan stores.
// Dates follow the current month so the default six-month view stays populated.
const customerNames = ['Sundar Apparel Co.', 'RK Sportswear', 'Urban Tees', 'College Culture Pvt. Ltd.', 'TeamStuff Merch', 'Anand Textiles', 'Metro Fashion', 'Coastal Knits', 'Summit Uniforms', 'Lotus Garments'];
const printTypes = ['DTF', 'Sublimation', 'Heat Transfer', 'Puff', 'Plastisol', 'HD', 'Screen Print'];
export function createDashboardMockData(entities: Entity[], end = today()): { bills: Bill[]; challans: Challan[] } {
  const bills: Bill[] = [];
  const deliveryChallans: Challan[] = [];
  const [year, month, day] = end.split('-').map(Number);
  const offsetDate = (date: string, days: number) => { const value = new Date(date + 'T00:00:00Z'); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10); };
  entities.forEach((seller, companyIndex) => {
    for (let monthIndex = 0; monthIndex < 6; monthIndex++) {
      const date = new Date(Date.UTC(year, month - 6 + monthIndex, Math.min(day, 8))).toISOString().slice(0, 10);
      for (let item = 0; item < 6; item++) {
        const serial = monthIndex * 6 + item + 1;
        const customer = { id: 'dashboard-customer-' + seller.id + '-' + (item % 5), legal_name: customerNames[(companyIndex * 5 + item % 5) % customerNames.length] };
        const bill: Bill = {
          id: 'dashboard-bill-' + seller.id + '-' + serial, seller, customer,
          date, due: offsetDate(date, item === 2 ? 3 : 30), reference: 'Sample order ' + serial,
          notes: 'Dashboard preview only', status: item === 5 ? 'Cancelled' : 'Issued',
          number: seller.entity_code + '-DEMO-' + String(serial).padStart(4, '0'), receipts: [],
          lines: [{ id: 1, description: 'Garment printing', quantity: String(800 + monthIndex * 180 + item * 90), rate: String(18 + companyIndex * 7 + item * 3), printType: printTypes[(serial + companyIndex) % printTypes.length] }],
        };
        if (item === 5) bill.cancellation = { date, reason: 'Sample cancelled order' };
        if (item === 0 || item === 1 || item === 3) bill.receipts = [{ id: 'dashboard-receipt-' + seller.id + '-' + serial, date, cents: item === 3 ? Math.round(billTotal(bill) * .45) : billTotal(bill), method: 'Bank transfer', reference: 'DEMO-' + serial }];
        bills.push(bill);
        if (item < 5) deliveryChallans.push({ id: 'dashboard-dc-' + seller.id + '-' + serial, entityId: seller.id, number: seller.entity_code + '-DC-DEMO-' + String(serial).padStart(4, '0'), date, recipient: customer.legal_name, from: 'Sample company address', to: 'Sample customer address', items: [{ description: 'Printed garments', quantity: bill.lines[0].quantity, unit: 'Pieces' }], notes: 'Dashboard preview only', billId: bill.id, billNumber: bill.number });
      }
    }
  });
  return { bills, challans: deliveryChallans };
}
