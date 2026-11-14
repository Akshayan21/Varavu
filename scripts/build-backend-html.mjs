// Refresh the data embedded in the checked-in, self-contained HTML handbook.
// The HTML is the layout source. No production database or network is used.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { draft, challan } from '../apps/api/dist/billing.js';
import { billingEntityInput, customerInput } from '../packages/shared/dist/index.js';

const require = createRequire(new URL('../apps/api/package.json', import.meta.url));
const { z } = require('zod');
const directory = 'docs/api/';
const filename = directory + 'Thogai-Backend-Handbook.html';
const html = readFileSync(filename, 'utf8');
const pattern = /(<script id="handbook-data" type="application\/json">)([\s\S]*?)(<\/script>)/;
const match = html.match(pattern);
if (!match) throw new Error('Handbook data block is missing.');
const data = JSON.parse(match[2]);
data.manifest = JSON.parse(readFileSync(directory + 'endpoint-manifest.json', 'utf8'));
data.examples = JSON.parse(readFileSync(directory + 'response-examples.json', 'utf8'));
data.catalog = JSON.parse(readFileSync(directory + 'schema-catalog.json', 'utf8'));
data.collection = JSON.parse(readFileSync(directory + 'Thogai.postman_collection.json', 'utf8'));
data.localGuide = readFileSync(directory + 'LOCAL_TESTING.md', 'utf8');
if (data.frontend) {
  for (const [from, to] of [
    ['pnpm install --frozen-lockfile', '# Uses dependencies already installed; fresh npm setup requires workspace conversion.'],
    ['pnpm --filter @billing/shared build', 'npm --prefix packages/shared run build'],
    ['pnpm --filter @billing/api build', 'npm --prefix apps/api run build'],
    ['pnpm --filter @billing/api start', 'npm --prefix apps/api start'],
    ['pnpm exec playwright install chromium', 'npm exec -- playwright install chromium'],
  ]) data.localGuide = data.localGuide.replaceAll(from, to);
}
const current = {
  InvoiceCreate: draft, InvoiceReplace: draft.omit({ id: true }).extend({ version: z.number().int().positive() }),
  ChallanCreate: challan, ChallanReplace: challan.omit({ id: true }).extend({ version: z.number().int().positive() }),
  CompanyCreate: billingEntityInput, CompanyPatch: billingEntityInput.partial(),
  CustomerCreate: customerInput, CustomerPatch: customerInput.partial(),
};
for (const [name, schema] of Object.entries(current)) data.schemas[name] = z.toJSONSchema(schema, { io: 'input' });
// Endpoint annotations are retained on the HTML layout, and matched by method/path.
const previous = JSON.parse(match[2]).manifest.endpoints;
for (const endpoint of data.manifest.endpoints) {
  const annotation = previous.find(item => item.method === endpoint.method && item.path === endpoint.path);
  if (!annotation) throw new Error('Add HTML field annotations for ' + endpoint.method + ' ' + endpoint.path);
  endpoint.bodySchema = annotation.bodySchema;
  endpoint.queryParameters = annotation.queryParameters;
}
const embedded = JSON.stringify(data).replaceAll('<', '\u003c').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');
writeFileSync(filename, html.replace(pattern, (_, start, old, end) => start + embedded + end));
console.log('Refreshed standalone handbook for ' + data.manifest.registeredRouteCount + ' routes and ' + data.catalog.tables.length + ' tables.');
