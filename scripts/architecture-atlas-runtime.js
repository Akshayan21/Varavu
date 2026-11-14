(() => {
 const $=id=>document.getElementById(id), eps=D.manifest.endpoints;
 const domains={
  Workspace:['Workspace gate / session','workspace.ts + operations.ts','workspaces, workspace_members, user_preferences'],
  Directories:['Company and customer screens','directory.ts + operations.ts','billing_entities, customers'],
  Documents:['Invoice / challan editor and document cache','billing.ts + operations.ts','invoices, invoice_items, delivery_challans, dc_items, styles, document_sequences, delivery_acknowledgements'],
  Payments:['Receipt action / payment management','billing.ts + operations.ts','payments, invoices, idempotency_keys'],
  Catalogs:['Style entry / catalog / template settings','billing.ts + operations.ts','styles, print_types, placements, units, tax_profiles, document_templates'],
  Files:['PDF / company assets / file management','billing.ts + operations.ts + pdf.ts','document_files; private Supabase Storage objects'],
  Analytics:['Dashboard / central reporting','operations.ts','company-scoped invoice, payment and customer aggregates'],
  Reports:['Report viewer / export download','reports.ts + operations.ts + pdf.ts','report_exports; financial source records; private Storage export objects'],
 };
 const simple=[['Your screen','You type a customer, style or bill. React keeps unsaved fields in memory.'],['The messenger','apiRequest sends a URL, access token and optional JSON to the API.'],['The checker','Fastify checks who you are and whether the information is valid.'],['The record store','PostgreSQL reads or changes authorized records. File operations also use private Storage.'],['Back to your screen','The server returns JSON or file bytes. React updates its state/cache or downloads the file.']];
 $('simple-system-map').innerHTML=simple.map(([title,desc],i)=>`<div class="atlas-node"><span class="atlas-index">0${i+1}</span><h4>${esc(title)}</h4><p>${esc(desc)}</p></div>${i<4?'<div class="atlas-arrow" aria-label="Then">→</div>':''}`).join('');
 $('deep-system-map').innerHTML=`<div class="atlas-lane"><h4>1 · Browser</h4><p>React Router → selected company screen</p><p>Controlled editor · TanStack Query · document-cache</p><p>apiRequest → fetch + Bearer JWT</p></div><div class="atlas-edge">HTTP request ↓ URL / query / headers / JSON<br>HTTP response ↑ status / JSON / file bytes</div><div class="atlas-lane"><h4>2 · Fastify boundary</h4><p>CORS → authenticate → company/workspace access → Zod validation</p><p>Workspace · Directories · Documents · Payments · Catalogs · Analytics · Files · Reports</p><p>Database error mapping → HTTP status + error JSON</p></div><div class="atlas-edge">Supabase client ↓ caller-scoped REST / RPC<br>Records / aggregates / transaction result ↑</div><div class="atlas-lane"><h4>3 · PostgreSQL</h4><p>RLS · composite foreign keys · unique codes · version checks</p><p>RPC transactions: style resolution, draft lines, numbering, receipts, reporting cutoffs</p><p>${D.catalog.tables.length} tables · complete fields and foreign-key relationships below</p></div><div class="atlas-branches"><div class="atlas-lane"><h4>Separate identity path</h4><p>Browser ↔ Supabase Auth: password sign-in / refresh → session token.</p><p>API ↔ Supabase Auth: validate the caller. The public project key is not the user token.</p></div><div class="atlas-lane"><h4>File branch</h4><p>API → document/report renderer → private Storage.</p><p>Database stores file metadata/status. API downloads return bytes; asset URL requests return a signed URL.</p><p>Rendering runs in the request/retry paths; this diagram does not imply an external queue worker.</p></div></div>`;
 $('atlas-family-map').innerHTML=table(['API family','Frontend responsibility / intended consumer','Server modules','Related data domain'],Object.entries(domains).map(([k,v])=>[esc(k),...v.map(esc)]));
 $('atlas-count').textContent=`${eps.length} endpoint examples · ${D.manifest.registeredRouteCount} registered routes · ${D.catalog.tables.length} tables`;
 $('atlas-local-inventory').innerHTML=table(['Method','Local URL template','Input','Output'],eps.map(e=>[esc(e.method),esc('http://127.0.0.1:3001'+e.path+(Object.keys(e.query||{}).length?'?'+new URLSearchParams(e.query):'')),esc((e.body!==undefined?'JSON body; ':'')+(Object.keys(e.query||{}).join(', ')||'No example query')),esc(String(e.status)+' · '+(e.response||'No body'))]));
 const tokenFields=['entityId','id','paymentId'];
 const needsKey=e=>e.method==='POST'&&e.path.endsWith('/payments');
 const selected=()=>eps[Number($('atlas-endpoint').value)||0];
 const pathFor=e=>e.path.replace(/\{(\w+)\}/g,(_,key)=>$('atlas-'+key)?.value.trim()||'{'+key+'}');
 const urlFor=e=>{
  const base=$('atlas-origin').value.trim().replace(/\/$/,'');
  const q=new URLSearchParams(Object.entries(e.query||{}).map(([k,v])=>[k,String(v)]));
  return base+pathFor(e)+(q.size?'?'+q:'');
 };
 function result(e){return e.status===204?{note:'HTTP 204: no response body.'}:['PDF','EXPORT'].includes(e.response)?{note:'Binary download, not JSON.',responseType:e.response}:D.examples[e.response]??{note:'See endpoint reference.'};}
 function command(e){
  const lines=[`$url = '${urlFor(e).replaceAll("'","''")}'`];
  if(e.body!==undefined)lines.push("$body = @'",JSON.stringify(e.body,null,2),"'@");
  lines.push(`$headers = @{ Authorization = "Bearer $env:THOGAI_TOKEN" }`);
  if(needsKey(e)) lines.push("$headers['Idempotency-Key'] = '<stable-key-for-this-payment>' # Keep unchanged on retry");
  const binary=['PDF','EXPORT'].includes(e.response);
  lines.push(`Invoke-RestMethod -Method ${e.method} -Uri $url${e.path==='/api/v1/health'?'':' -Headers $headers'}${e.body!==undefined?" -ContentType 'application/json' -Body $body":''}${binary?" -OutFile './download.bin'":''}`);
  return lines.join('\n');
 }
 const phaseText=[
  ['You ask the application','The selected API receives the URL and query below. A write may also include a JSON body. This is an illustration; choosing an endpoint does not send it.'],
  ['The server checks the request','Protected endpoints require a valid owner access token. The server checks access and validates path, query and body fields. Invalid requests return an error before the intended operation.'],
  ['The operation runs','The selected family below identifies the related data domain. Reads return existing records; writes apply constraints and transactions. A file operation may render or read private Storage. Not every endpoint touches every table in its family.'],
  ['The result comes back','The response panel shows the documented status and synthetic success example. Downloads return bytes; HTTP 204 has no body. Errors use their own status and error JSON.'],
  ['The browser uses the answer','Currently connected screens update React state, query results or the document cache, or download a Blob. Backend-only endpoints need a future screen connection; this map does not add one.'],
 ];
 let phase=0;
 function render(){
  const e=selected(), domain=domains[e.group], url=urlFor(e);
  $('atlas-local-url').textContent=e.method+' '+url;
  $('atlas-owner').textContent=domain[0]+' → '+domain[1]+' → '+domain[2];
  $('atlas-phase-title').textContent=phaseText[phase][0];$('atlas-phase-description').textContent=e.path==='/api/v1/health'?'Health checks only the API process: no token or database operation is required. The API returns {"status":"ok"}.':phaseText[phase][1];
  $('atlas-phase').textContent=(phase+1)+' / 5';
  $('simple-system-map').querySelectorAll('.atlas-node').forEach((n,i)=>n.classList.toggle('atlas-active',i===[0,2,3,4,0][phase]));
  $('atlas-input').textContent=JSON.stringify({method:e.method,url,authentication:e.path==='/api/v1/health'?'None':'Authorization: Bearer <owner-access-token>',pathParameters:[...e.path.matchAll(/\{(\w+)\}/g)].map(m=>({name:m[1],value:$('atlas-'+m[1])?.value||'<your record UUID>'})),headers:{...(e.path==='/api/v1/health'?{}:{Authorization:'Bearer <owner-access-token>'}),...(e.body!==undefined?{'Content-Type':'application/json'}:{}),...(needsKey(e)?{'Idempotency-Key':'<stable-key-for-this-payment>'}:{})},query:e.query||{},body:e.body??null},null,2);
  $('atlas-output').textContent=JSON.stringify({status:e.status,response:result(e)},null,2);
  $('atlas-command').textContent=command(e);
  $('atlas-validation').innerHTML=`<strong>${esc(e.title)}</strong><p>Body contract: ${esc(e.bodySchema||'See operation contract; no named body schema')}. Query fields: ${esc((e.queryParameters||[]).map(p=>p.name+' ('+p.type+')').join(', ')||'No declared query fields')}.</p><p>${esc(e.notes||'See the full endpoint reference for field requirements and errors.')}</p>`;
  if(motionReady) {
   if($('atlas-flow-picker').innerHTML!==$('atlas-endpoint').innerHTML)$('atlas-flow-picker').innerHTML=$('atlas-endpoint').innerHTML;
   $('atlas-flow-picker').value=$('atlas-endpoint').value;
   $('atlas-inline-input').textContent=$('atlas-input').textContent;
   $('atlas-inline-output').textContent=$('atlas-output').textContent;
   drawMotion();
  }
 }
 function filter(){
  const q=$('atlas-search').value.toLowerCase();const previous=$('atlas-endpoint').value;
  const matches=eps.map((e,i)=>({e,i})).filter(({e})=>(!$('atlas-method').value||e.method===$('atlas-method').value)&&JSON.stringify(e).toLowerCase().includes(q));
  $('atlas-endpoint').innerHTML=matches.map(({e,i})=>`<option value="${i}">${esc(e.method+' '+e.path+' — '+e.title)}</option>`).join('');
  if(matches.some(m=>String(m.i)===previous))$('atlas-endpoint').value=previous;
  $('atlas-matches').textContent=matches.length+' matching examples';
  $('atlas-detail').hidden=!matches.length;if(matches.length)render();
 }
 $('atlas-search').addEventListener('input',filter);$('atlas-method').addEventListener('change',filter);
 $('atlas-endpoint').addEventListener('change',()=>{stopMotion();motionTime=1100;lastBeat=-1;phase=0;render();});
 ['origin',...tokenFields].forEach(key=>$('atlas-'+key).addEventListener('input',render));
 $('atlas-prev').addEventListener('click',()=>jumpBeat(beatAt(motionTime)-1));
 $('atlas-next').addEventListener('click',()=>jumpBeat(beatAt(motionTime)+1));
 $('atlas-contract').addEventListener('click',()=>{$('api-search').value=selected().path;$('method-filter').value=selected().method;$('group-filter').value='';$('api-search').dispatchEvent(new Event('input'));location.hash='endpoints';});
 $('atlas-copy').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(command(selected()));$('atlas-copy').textContent='Copied';}catch{$('atlas-copy').textContent='Select the command below to copy';}});
 // One approved scene, reused for every endpoint; no automatic endpoint cycling.
 const durations=[3000,3500,4300,3600,3300,4000,2900];
 const phases=[0,0,1,2,3,3,4], rests=[false,true,false,false,true,false,true];
 const titles=['You send a request','Pause to read the request','The server checks it','Read or change a record','Pause to read the result','The answer travels back','The screen uses the answer'];
 const starts=durations.map((_,i)=>durations.slice(0,i).reduce((a,b)=>a+b,0));
 const motionTotal=durations.reduce((a,b)=>a+b,0), reduce=matchMedia('(prefers-reduced-motion: reduce)');
 let motionTime=1100,motionPlaying=false,motionFrame=0,motionLast=null,motionReady=false,lastBeat=-1;
 const pilot=$('atlas-pilot'), map=$('simple-system-map');
 pilot.querySelector('h3').insertAdjacentHTML('afterend','<label class="atlas-flow-label">Choose any API <select id="atlas-flow-picker" aria-label="Choose API to animate"></select></label>');
 pilot.insertAdjacentHTML('beforeend','<details class="atlas-inline-data"><summary>Read the exact example request and response</summary><div class="atlas-payloads"><div><h4>Request</h4><pre id="atlas-inline-input"></pre></div><div><h4>Response</h4><pre id="atlas-inline-output"></pre></div></div></details>');
 // Keep camera transforms off the responsive layout owner.
 map.insertAdjacentHTML('beforebegin','<div id="atlas-camera"></div>');$('atlas-camera').append(map);
 pilot.querySelector('.atlas-caption').remove();
 pilot.insertAdjacentHTML('beforeend',`<div class="atlas-motion-controls"><button id="atlas-play">Play</button><button id="atlas-replay">Replay</button><button id="atlas-beat-prev" aria-label="Previous animation step">← Step</button><button id="atlas-beat-next" aria-label="Next animation step">Step →</button><label>Speed <select id="atlas-speed"><option value="0.25">0.25×</option><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="1.5">1.5×</option></select></label><input type="range" id="atlas-scrub" min="0" max="1000" step="1" value="0" aria-label="Architecture animation position"><span id="atlas-time"></span></div><p id="atlas-live-caption" class="atlas-live-caption" aria-live="polite"></p><p id="atlas-motion-note" class="atlas-caption"></p><div class="atlas-packet" id="atlas-packet" aria-hidden="true"><span></span><b id="atlas-packet-label">Request</b></div>`);
 const crawlerSvg=id=>`<svg id="${id}" class="atlas-crawler" aria-hidden="true"><path class="crawler-track"/><path class="crawler-trace" pathLength="1"/>${Array.from({length:7},(_,i)=>`<circle class="crawler-segment" r="${Math.max(1.2,4.5-i*.48)}"/>`).join('')}</svg>`;
 pilot.insertAdjacentHTML('beforeend',crawlerSvg('atlas-simple-crawler'));
 $('deep-system-map').insertAdjacentHTML('beforeend',crawlerSvg('atlas-deep-crawler'));
 function crawl(svg,boxes,root,from,to,q,vertical,visible){
  const a=boxes[from],b=boxes[to];if(!a||!b)return;
  const r=root.getBoundingClientRect();
  svg.setAttribute('viewBox',`0 0 ${r.width} ${r.height}`);
  const ax=vertical?a.left-r.left:a.left+a.width/2-r.left,ay=vertical?a.top+a.height/2-r.top:a.bottom-r.top;
  const bx=vertical?b.left-r.left:b.left+b.width/2-r.left,by=vertical?b.top+b.height/2-r.top:b.bottom-r.top;
  const rail=vertical?Math.max(8,Math.min(ax,bx)-13):Math.max(ay,by)+17;
  const d=vertical?`M${ax} ${ay} H${rail} V${by} H${bx}`:`M${ax} ${ay} V${rail} H${bx} V${by}`;
  const [track,trace]=svg.querySelectorAll('path');track.setAttribute('d',d);trace.setAttribute('d',d);
  trace.style.strokeDasharray='1';trace.style.strokeDashoffset=String(1-q);
  trace.style.opacity=visible?'1':'0';
  const length=track.getTotalLength();
  svg.querySelectorAll('circle').forEach((dot,i)=>{
   const progress=Math.max(0,q-i*.018),point=track.getPointAtLength(length*progress);
   dot.setAttribute('cx',point.x);dot.setAttribute('cy',point.y);dot.style.opacity=visible&&q>=i*.018?String(1-i*.11):'0';
  });
 }
 const clip=n=>Math.max(0,Math.min(1,n));
 const out=n=>1-Math.pow(1-clip(n),5);
 const inOut=n=>{const p=clip(n);return p<.5?4*p*p*p:1-Math.pow(-2*p+2,3)/2;};
 function beatAt(t){let i=starts.findIndex((s,i)=>t<s+durations[i]);return i<0?durations.length-1:i;}
 function stopMotion(){motionPlaying=false;cancelAnimationFrame(motionFrame);motionLast=null;$('atlas-play').textContent='Play';}
 function drawMotion(){
  const beat=beatAt(motionTime),p=clip((motionTime-starts[beat])/durations[beat]),e=selected();
  const health=e.path==='/api/v1/health',binary=['PDF','EXPORT'].includes(e.response);
  const nodes=[...map.querySelectorAll('.atlas-node')];
  nodes[3].querySelector('h4').textContent=health?'No database needed':binary?'Records and file store':'The record store';
  nodes[3].querySelector('p').textContent=health?'This endpoint only checks the running API process. It does not read or write business records.':binary?'The API reads authorized records and renders or retrieves a file. Private Storage holds file bytes.':e.method==='GET'?'The database reads authorized records or calculates a summary. This request does not intentionally change business records.':'The server applies the selected operation. Database rules and transactions protect related records.';
  nodes.forEach((node,i)=>{
   const arrival=reduce.matches?1:out((motionTime-i*160)/600);
   node.style.opacity=String(arrival);node.style.transform=`translateY(${24*(1-arrival)}px)`;
   node.style.filter=`blur(${4*(1-arrival)}px)`;
   node.classList.toggle('atlas-active',i===[1,1,2,health?2:3,4,4,0][beat]);
  });
  const camera=reduce.matches?0:Math.sin(motionTime/motionTotal*Math.PI/2);
  $('atlas-camera').style.transform=`translate3d(${camera*2}px,${-camera*2}px,0) scale(${1+camera*.008})`;
  const lanes=[...$('deep-system-map').querySelectorAll('.atlas-lane')];
  const lane=beat<2||beat===6?0:beat===2||health?1:beat===3?2:0;
  lanes.forEach((node,i)=>node.classList.toggle('atlas-active',i===lane||!health&&beat===3&&i===4&&['Files','Reports'].includes(e.group)));
  const packet=$('atlas-packet');packet.hidden=reduce.matches||rests[beat]||p<.05||p>.96;
  if(!packet.hidden){
   const pair=beat===0?[0,2]:beat===2?[2,health?2:3]:beat===3?[health?2:3,4]:[4,0];
   const q=inOut((p-.05)/.91);
   crawl($('atlas-simple-crawler'),nodes.map(n=>n.getBoundingClientRect()),pilot,pair[0],pair[1],q,getComputedStyle(map).flexDirection==='column',true);
   const deepPair=beat===0?[0,1]:beat===2?[1,health?1:2]:beat===3?[health?1:2,1]:[1,0];
   crawl($('atlas-deep-crawler'),lanes.map(n=>n.getBoundingClientRect()),$('deep-system-map'),deepPair[0],deepPair[1],q,true,true);
   $('atlas-packet-label').textContent=beat===0?'URL + token'+(e.body?' + JSON':''):beat===2?health?'Process check':e.method==='GET'?'Read authorized records':'Validate → transaction':binary?'File bytes':e.status===204?'204 · no body':'Response JSON';
  }
  if(packet.hidden)document.querySelectorAll('.atlas-crawler .crawler-segment,.atlas-crawler .crawler-trace').forEach(n=>n.style.opacity='0');
  if(lastBeat!==beat){
   lastBeat=beat;phase=phases[beat];
   $('atlas-live-caption').textContent=`${beat+1} / 7 · ${health&&beat===3?'Check the API process':titles[beat]}${health?' — health skips database access.':rests[beat]?' — read the data panels below at your own pace.':''}`;
   $('atlas-live-caption').dataset.beat=String(beat+1);
  }
  $('atlas-scrub').value=String(Math.round(motionTime/motionTotal*1000));
  $('atlas-time').textContent=`${(motionTime/1000).toFixed(1)} / ${(motionTotal/1000).toFixed(1)} s`;
 }
 function seekMotion(t){motionTime=Math.max(0,Math.min(motionTotal,t));phase=phases[beatAt(motionTime)];render();}
 function jumpBeat(i){stopMotion();const index=Math.max(0,Math.min(6,i));seekMotion(starts[index]+1100);}
 function tickMotion(now){
  if(!motionPlaying)return;
  const before=beatAt(motionTime);
  if(motionLast!==null)motionTime=Math.min(motionTotal,motionTime+(now-motionLast)*Number($('atlas-speed').value));
  motionLast=now;
  if(before!==beatAt(motionTime)){phase=phases[beatAt(motionTime)];render();}else drawMotion();
  if(motionTime>=motionTotal)stopMotion();else motionFrame=requestAnimationFrame(tickMotion);
 }
 function playMotion(){if(reduce.matches)return;if(motionTime>=motionTotal)seekMotion(0);motionPlaying=true;motionLast=null;$('atlas-play').textContent='Pause';motionFrame=requestAnimationFrame(tickMotion);}
 $('atlas-play').addEventListener('click',()=>motionPlaying?stopMotion():playMotion());
 $('atlas-flow-picker').addEventListener('change',()=>{$('atlas-endpoint').value=$('atlas-flow-picker').value;$('atlas-endpoint').dispatchEvent(new Event('change'));});
 $('atlas-replay').addEventListener('click',()=>{stopMotion();seekMotion(reduce.matches?1100:0);playMotion();});
 $('atlas-beat-prev').addEventListener('click',()=>jumpBeat(beatAt(motionTime)-1));
 $('atlas-beat-next').addEventListener('click',()=>jumpBeat(beatAt(motionTime)+1));
 $('atlas-scrub').addEventListener('input',e=>{stopMotion();seekMotion(Number(e.target.value)/1000*motionTotal);});
 function motionPreference(){stopMotion();$('atlas-play').disabled=reduce.matches;$('atlas-motion-note').textContent=reduce.matches?'Reduced motion: use step controls or scrub to inspect static states.':'Offline illustration · synthetic examples · no live API requests · pauses for reading · stops after one walkthrough.';if(motionReady)drawMotion();}
 $('atlas-search').addEventListener('input',()=>{stopMotion();lastBeat=-1;});
 $('atlas-method').addEventListener('change',()=>{stopMotion();lastBeat=-1;});
 addEventListener('resize',()=>{if(!$('atlas-detail').hidden)drawMotion();});
 addEventListener('beforeprint',()=>{stopMotion();nodesForPrint();});
 function nodesForPrint(){map.querySelectorAll('.atlas-node').forEach(n=>{n.style.opacity='1';n.style.transform='none';n.style.filter='none';});$('atlas-packet').hidden=true;}
 document.addEventListener('visibilitychange',()=>{if(document.hidden)stopMotion();});
 reduce.addEventListener('change',motionPreference);
 motionReady=true;filter();motionPreference();
})();
