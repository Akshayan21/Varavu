import { expect, test, vi } from 'vitest';
import { buildApp } from './build-app.js';

test('authenticates style resolution and forwards only the company and entered number',async()=>{
  const entity='460e73a5-5733-41df-bcd0-f87134395c01';
  const style={id:'460e73a5-5733-41df-bcd0-f87134395c05',style_number:'ST-001'};
  const calls:unknown[]=[];
  vi.stubGlobal('fetch',async(input:RequestInfo|URL,init?:RequestInit)=>{
    const request=new Request(input,init);
    expect(request.headers.get('authorization')).toBe('Bearer owner-token');
    if(new URL(request.url).pathname==='/auth/v1/user')return Response.json({id:entity,email:'owner@example.test'});
    expect(new URL(request.url).pathname).toBe('/rest/v1/rpc/resolve_style');
    expect(request.headers.get('accept')).toContain('object');
    calls.push(await request.json());
    return Response.json(style);
  });
  const app=buildApp({origin:'http://localhost:5173',supabase:{url:'https://supabase.example.test',key:'publishable-key'}});
  try {
    const response=await app.inject({method:'POST',url:`/api/v1/entities/${entity}/styles/resolve`,headers:{authorization:'Bearer owner-token'},payload:{number:' ST-001 '}});
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(style);
    expect(calls).toEqual([{p_entity:entity,p_number:'ST-001'}]);
    expect((await app.inject({method:'POST',url:`/api/v1/entities/${entity}/styles/resolve`,payload:{number:'ST-001'}})).statusCode).toBe(401);
  } finally {await app.close();vi.unstubAllGlobals();}
});

test('rejects payment posts without a retry key before calling the database',async()=>{
  vi.stubGlobal('fetch',async()=>Response.json({id:'460e73a5-5733-41df-bcd0-f87134395c01',email:'owner@example.test'}));
  const app=buildApp({origin:'http://localhost:5173',supabase:{url:'https://supabase.example.test',key:'publishable-key'}});
  try {
    const response=await app.inject({method:'POST',url:'/api/v1/entities/460e73a5-5733-41df-bcd0-f87134395c01/invoices/460e73a5-5733-41df-bcd0-f87134395c06/payments',
      headers:{authorization:'Bearer owner-token'},payload:{date:'2026-11-13',cents:10000,method:'cash'}});
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain('identifier');
  } finally {await app.close();vi.unstubAllGlobals();}
});
