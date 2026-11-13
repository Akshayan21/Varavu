import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';

test('database mode resolves styles, persists drafts through the API, and reloads issued bills',async({page})=>{
  const entity={id:randomUUID(),legal_name:'Database Company',entity_code:'DB',default_due_days:30,is_active:true};
  const customer={id:randomUUID(),legal_name:'Database Customer',is_active:true};
  const styles=new Map<string,{id:string;style_number:string}>();
  const bills:any[]=[];
  const writes:any[]=[];
  const errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/v1/**',async route=>{
    const request=route.request();const url=new URL(request.url());const path=url.pathname;
    const send=(value:unknown)=>route.fulfill({json:value});
    if(path.endsWith('/workspace/initialize'))return send({workspace:{id:randomUUID()}});
    if(path.endsWith('/workspace/documents'))return send({bills,challans:[],hasMore:false});
    if(path==='/api/v1/entities')return send({data:[entity],total:1});
    if(path.endsWith('/customers'))return send({data:[customer],total:1});
    if(path.endsWith('/catalog'))return send({print_types:[],placements:[],units:[],tax_profiles:[],document_templates:[]});
    function resolve(number:string) {
      const normalized=number.trim().toUpperCase();
      if(!styles.has(normalized))styles.set(normalized,{id:randomUUID(),style_number:normalized});
      return styles.get(normalized)!;
    }
    if(path.endsWith('/styles/resolve'))return send(resolve(request.postDataJSON().number));
    if(path.endsWith('/styles'))return send({data:[...styles.values()]});
    if(path.endsWith('/invoices') && request.method()==='POST') {
      const input=request.postDataJSON();writes.push(input);
      const saved={...input,version:2,seller:entity,customer,status:'Draft',receipts:[],totalCents:1000,
        lines:input.lines.map((line:any)=>line.style?{...line,styleId:resolve(line.style).id,style:resolve(line.style).style_number}:line)};
      const previous=bills.findIndex(bill=>bill.id===saved.id);
      if(previous>=0)bills[previous]=saved;else bills.push(saved);
      return send(saved);
    }
    if(path.endsWith('/issue')) {
      const bill=bills.find(row=>path.includes(row.id));
      bill.status='Issued';bill.number='DB/26-27/0001';bill.version++;
      return send(bill);
    }
    throw new Error('Unexpected API request '+path);
  });
  await page.goto('/');
  await page.getByRole('link',{name:'Open Database Company'}).click();
  await page.getByRole('link',{name:'Create a bill',exact:true}).click();
  await page.getByRole('combobox',{name:'Customer',exact:true}).click();
  await page.getByRole('option',{name:'Database Customer'}).click();
  await page.getByLabel('description for item 1').fill('Database printing');
  await page.getByLabel('rate for item 1').fill('10');
  await page.getByLabel('Service / style code').fill(' st-100 ');
  await page.getByLabel('quantity for item 1').click();
  await expect(page.getByLabel('Service / style code')).toHaveValue('ST-100');
  await page.getByRole('button',{name:'Save draft',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Bill draft'})).toBeVisible();
  expect(styles.size).toBe(1);
  expect(writes[0].lines[0].styleId).toBe(styles.get('ST-100')!.id);
  expect(await page.evaluate(()=>localStorage.getItem('thogai-mock-bills-v1'))).toBeNull();
  await page.reload();
  await expect(page.locator('.invoice-print-sheet')).toContainText('ST-100');
  await page.getByRole('button',{name:'Issue bill',exact:true}).click();
  await page.getByRole('button',{name:'Confirm issue'}).click();
  await expect(page.getByRole('heading',{name:'DB/26-27/0001'})).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading',{name:'DB/26-27/0001'})).toBeVisible();
  expect(errors).toEqual([]);
});
