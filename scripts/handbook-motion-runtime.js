// Embedded offline player. All visual state is sampled from a finite timeline.
(() => {
  const el = id => document.getElementById(id);
  const f = D.frontend;
  for (const [id, headers, rows] of [
    ['frontend-modules', ['Source module', 'Role', 'Responsibility'], f.modules],
    ['frontend-routes', ['Route', 'Screen composition'], f.routes.map(r => [r.path, r.element])],
    ['frontend-state', ['State', 'Owner', 'Purpose'], f.state],
    ['frontend-integration', ['Capability', 'Integration status', 'Data path'], f.integration],
    ['frontend-boundary-table', ['Boundary', 'Responsibility'], [
      ['Browser', 'Collect input, provide early validation, attach access token, render returned state.'],
      ['Fastify', 'Authenticate owner, authorize workspace/company, validate contracts, map errors, dispatch transactional operations.'],
      ['PostgreSQL', 'Enforce RLS, foreign keys, unique style codes, version checks, financial invariants and atomic writes.'],
      ['Response', 'JSON updates React/query/document state; authenticated file endpoints return a Blob for download.'],
    ]],
  ]) el(id).innerHTML = table(headers, rows.map(row => row.map(esc)));
  el('npm-frontend-commands').innerHTML = code('# Existing installed checkout; separate terminals for API and web\nnpm --prefix packages/shared run build\nnpm --prefix apps/api run build\nnpm --prefix apps/api start\nnpm --prefix apps/web run dev\n\n# Validation\nnpm --prefix apps/web run build\nnpm --prefix apps/api run typecheck\nnpm exec -- vitest run', 'shell');
  const endpoint = suffix => D.manifest.endpoints.find(e => e.path.endsWith(suffix) && e.method === 'POST');
  const resolve = endpoint('/styles/resolve'), save = endpoint('/invoices'), issue = endpoint('/invoices/{id}/issue');
  const step = (title, description, active, route, request, response, labels) => ({title, description, active, route, request, response, labels, duration: 3400});
  const req = e => ({method:e.method, path:e.path, headers:{Authorization:'Bearer <owner-access-token>', 'Content-Type':'application/json'}, body:e.body});
  const flows = {
    style: {name:'STYLE RESOLUTION', steps:[
      step('Enter a style number', 'The controlled style field holds the typed number. A 200 ms debounce searches existing styles; this read-only search does not create a record.', 0, null, {method:'GET', path:'/api/v1/entities/{entityId}/styles?search=ST-001'}, D.examples.StyleSearch, ['style-field.tsx','number = ST-001','200 ms search debounce']),
      step('Resolve on blur or Enter', 'apiRequest obtains the current Supabase session and attaches its access token. The field sends the number to the resolve endpoint.', 1, [0,1], req(resolve), null),
      step('Validate and authorize', 'Fastify checks the signed-in owner, company access, and the number contract. Browser validation cannot replace these checks.', 1, null, req(resolve), null),
      step('Reuse or create atomically', 'The database normalizes the company-scoped style key. Its unique constraint and transactional resolution reuse an existing row or insert one without duplicate codes.', 2, [1,2], {operation:'resolve style', number:'ST-001', scope:'authorized company'}, D.examples.Style),
      step('Return the stored style', 'Both existing and newly created styles return HTTP 200 with the full row. This is an actual captured synthetic response; the endpoint reference below contains the complete contract.', 0, [2,0], req(resolve), D.examples.Style),
      step('Store the style ID in editor state', 'The latest-input guard ignores stale responses. The editor retains the resolved ID and defaults. Saving the invoice resolves its line styles again inside the database transaction, so correctness does not depend on blur.', 0, null, {nextAction:'save invoice with line style'}, D.examples.Style, ['latest-input guard','resolved style ID','ready to save draft']),
    ]},
    invoice: {name:'SAVE AND ISSUE', steps:[
      step('Prepare the draft locally', 'React state owns unsaved inputs and the paper preview. Local totals help the user; the server calculates authoritative financial values.', 0, null, save.body, null, ['invoice-draft.tsx','controlled form state','local paper preview']),
      step('Submit a stable creation ID', 'saveBill sends the draft with a stable UUID. Reuse that UUID when retrying creation. The API validates the customer, company, line values and catalog references.', 1, [0,1], req(save), null),
      step('Commit draft and line styles', 'The transaction resolves missing styles, writes line items, and calculates totals. Any failing invariant rolls back the transaction.', 2, [1,2], req(save), D.examples.InvoiceDraft),
      step('Replace the cached invoice', 'The returned full invoice is passed to cacheBill. Subscribers update the list and paper view from the authoritative record.', 0, [2,0], req(save), D.examples.InvoiceDraft, ['mock-bills.ts adapter','cacheBill(response)','subscribers rerender']),
      step('Issue with a version check', 'The issue action sends the current document version. PostgreSQL checks it, locks numbering, allocates the invoice number and freezes issued document values.', 2, [0,2], req(issue), D.examples.InvoiceIssued),
      step('Display the issued record', 'The response updates the cache with the issued invoice. The separate authenticated PDF endpoint returns a Blob when the user requests a server-generated download.', 0, [2,0], req(issue), D.examples.InvoiceIssued, ['billing.tsx','issued number + totals','print / PDF download']),
    ]},
    auth: {name:'SIGN IN AND HYDRATE', steps:[
      step('Sign in with Supabase Auth', 'The browser Auth client communicates directly with Supabase Auth using the public project configuration. This authentication path bypasses Fastify; database mutations still use the API.', 2, [0,2], {service:'Supabase Auth', operation:'signInWithPassword', email:'owner@example.test', password:'<user-entered password>'}, {session:'Supabase session; tokens intentionally omitted'}, ['utils/supabase.ts','Supabase Auth client','public project key']),
      step('Attach the owner access token', 'The Auth event starts the workspace gate. apiRequest reads the current session and attaches its Bearer access token to protected API requests.', 1, [0,1], {method:'POST',path:'/api/v1/workspace/initialize',headers:{Authorization:'Bearer <owner-access-token>'}}, null),
      step('Initialize the owner workspace', 'Fastify verifies the user with Supabase Auth, authorizes the workspace and returns its ID for WorkspaceContext.', 2, [1,2], {method:'POST',path:'/api/v1/workspace/initialize'}, D.examples.Initialized),
      step('Load paginated documents', 'refreshDocuments requests the workspace document feed until hasMore is false. Each request is authenticated; subsequent pages are collected before replacing the read model.', 1, [0,1], {method:'GET',path:'/api/v1/workspace/documents?page=1'}, D.examples.Documents),
      step('Publish the new read model', 'replaceDocuments publishes bills and challans to useSyncExternalStore subscribers. The session epoch check prevents a late response from an old session from replacing current data.', 0, [2,0], {operation:'replaceDocuments after all pages'}, {effect:'React subscribers rerender; WorkspaceContext supplies workspace ID'}, ['document-cache.ts','session epoch guard','replaceDocuments']),
    ]},
    error: {name:'ERROR BOUNDARY', steps:[
      step('Submit an authenticated action', 'Every protected action crosses the same transport boundary. This example shows an expired or invalid access token rather than a successful mutation.', 1, [0,1], req(resolve), null),
      step('Reject before mutation', 'Fastify rejects failed authentication before a database write. The API error response is described in the errors section; the object here is a minimal illustrative error shape.', 1, null, req(resolve), {error:'Unauthorized'}),
      step('Surface the API error', 'requestJson throws the error message. The calling screen displays its action error; a failed response must not be installed as a successful document cache update.', 0, [1,0], {operation:'requestJson failure'}, {effect:'action error; no successful cache replacement'}, ['requestJson throws','screen shows error','cached record retained']),
      step('Recover through sign-in', 'The user restores a valid session through Supabase Auth. This is an explanatory recovery path, not a promise that the application automatically retries every failed action.', 2, [0,2], {operation:'restore authenticated session'}, {effect:'new valid access token'}),
      step('Retry deliberately', 'The user can retry after authentication. Draft creation reuses its UUID, while versioned document actions must use the latest version. Validation and authorization run again.', 1, [0,1], req(resolve), D.examples.Style),
    ]},
  };
  Object.values(flows).forEach(flow => flow.steps.forEach((s,i) => {s.duration=[3200,3900,3500,4300,3700,4100][i];}));
  const nodes = ['front','api','store'].map(n => el('motion-node-'+n));
  const wires = ['front-api','api-store'].map(n => el('motion-wire-'+n));
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let flow = flows.style, time = 1100, playing = false, frame = 0, last = null, current = -1;
  const clamp = n => Math.max(0,Math.min(1,n));
  const inOut = n => {const p=clamp(n);return p<.5?4*p*p*p:1-Math.pow(-2*p+2,3)/2;};
  const ease = n => 1-Math.pow(1-clamp(n),3);
  const total = () => flow.steps.reduce((a,b)=>a+b.duration,0);
  const startAt = i => flow.steps.slice(0,i).reduce((sum,s)=>sum+s.duration,0);
  const indexAt = t => {let end=0;const i=flow.steps.findIndex(s=>(end+=s.duration)>t);return i<0?flow.steps.length-1:i;};
  const pause = () => {playing=false;cancelAnimationFrame(frame);last=null;el('motion-play').textContent='Play';};
  const updateCaption = i => {
    const s=flow.steps[i]; current=i;
    el('motion-step-title').textContent=s.title;
    el('motion-step-description').textContent=s.description;
    el('motion-phase').textContent=`STEP ${i+1} / ${flow.steps.length}`;
    // Reuse stable code entries rather than allocating copy buffers on every scrub.
    for (const [id,value,label] of [['motion-request-json',s.request,'Input / operation'],['motion-response-json',s.response,'Output / effect']]) {
      el(id).innerHTML='<h5>'+label+'</h5><pre><code>'+esc(JSON.stringify(value ?? {note:'No response at this step; request still in progress.'},null,2))+'</code></pre>';
    }
    [...el('motion-steps').children].forEach((b,k)=>b.setAttribute('aria-current',k===i?'step':'false'));
  };
  function render(t) {
    time=Math.max(0,Math.min(total(),t));
    const i=indexAt(time), s=flow.steps[i], p=clamp((time-startAt(i))/s.duration), mobile=innerWidth<=700;
    if(i!==current) updateCaption(i);
    el('motion-eyebrow').textContent=flow.name;
    el('motion-svg').setAttribute('viewBox', mobile?'0 0 440 900':'0 0 1020 500');
    const xy=mobile?[[78,145],[78,390],[78,635]]:[[55,165],[378,165],[707,165]], scale=mobile?1.1:1;
    nodes.forEach((node,k)=>{
      const e=reduced.matches?1:ease((time-k*160)/600);
      node.setAttribute('transform',`translate(${xy[k][0]} ${xy[k][1]+22*(1-e)}) scale(${scale})`);
      node.style.opacity=e;node.style.filter=`blur(${6*(1-e)}px)`;
      node.querySelector('.active-halo').style.opacity=k===s.active ? .75 : 0;
      node.querySelector('.node-sweep').setAttribute('x', reduced.matches?-100:-100+440*ease(p));
    });
    const ds=mobile?['M220 347 C220 360 220 377 220 390','M220 592 C220 610 220 620 220 635']:['M313 258 C335 258 347 258 378 258','M636 258 C660 258 676 258 707 258'];
    wires.forEach((w,k)=>{w.setAttribute('d',ds[k]);el(k?'wire-api-store':'wire-front-api').setAttribute('d',ds[k]);w.style.strokeDasharray='1';w.style.strokeDashoffset=1-inOut(p);});
    const feet=el('motion-svg').querySelectorAll('.scene-foot');
    feet.forEach((n,k)=>{n.setAttribute('y',mobile?865+k*22:416+k*33);n.setAttribute('x',mobile?30:55);n.style.fontSize=mobile?'8px':'';});
    const label=el('motion-wire-label');label.textContent=mobile?'BROWSER → API → DATABASE → STATE':'Browser request → server validation → transaction → response';
    const packet=el('motion-packet');packet.style.opacity=s.route&&!reduced.matches?1:0;
    if(s.route){
      const [a,b]=s.route, q=inOut(p), centers=xy.map(([x,y])=>[x+129*scale,y+93*scale]);
      const x=centers[a][0]+(centers[b][0]-centers[a][0])*q;
      const y=centers[a][1]+(centers[b][1]-centers[a][1])*q;
      packet.setAttribute('transform',`translate(${x} ${y})`);
    }
    const lines=s.labels||['apiRequest + Bearer','validated request','await response'];
    lines.forEach((v,k)=>el('front-line-'+(k+1)).textContent=v);
    el('store-title').textContent=el('motion-scenario').value==='auth'&&i===0?'Supabase Auth':'PostgreSQL';
    ['authenticate owner','validate contract','dispatch operation'].forEach((v,k)=>el('api-line-'+(k+1)).textContent=v);
    ['company-scoped records','constraints + RLS','atomic transaction'].forEach((v,k)=>el('store-line-'+(k+1)).textContent=v);
    const q=Math.sin(time/total()*Math.PI/2);
    el('motion-camera').style.transform=reduced.matches?'none':`translate(${(q-.5)*4}px,${-q*2}px) scale(${1.005+q*.018})`;
    el('motion-progress').style.transform=`scaleX(${time/total()})`;
    el('motion-scrub').value=Math.round(time/total()*1000);
    el('motion-clock').textContent=`${(time/1000).toFixed(1)} / ${(total()/1000).toFixed(1)} s`;
    el('communication-motion').dataset.step=String(i+1);
  }
  function tick(now){
    if(!playing)return;
    if(last!==null)render(time+(now-last)*Number(el('motion-speed').value));
    last=now;
    if(time>=total())pause();else frame=requestAnimationFrame(tick);
  }
  function play(){if(reduced.matches)return;if(time>=total())time=0;playing=true;last=null;el('motion-play').textContent='Pause';frame=requestAnimationFrame(tick);}
  const jump=i=>{pause();render(startAt(Math.max(0,Math.min(flow.steps.length-1,i)))+1100);};
  function select(){pause();flow=flows[el('motion-scenario').value];current=-1;
    el('motion-steps').innerHTML=flow.steps.map((s,i)=>`<button data-step="${i}" title="${esc(s.title)}">${i+1}. ${esc(s.title)}</button>`).join('');
    el('motion-print-summary').innerHTML='<ol>'+flow.steps.map(s=>'<li><strong>'+esc(s.title)+'</strong> — '+esc(s.description)+'</li>').join('')+'</ol>';
    render(1100);
  }
  el('motion-scenario').addEventListener('change',select);
  el('motion-play').addEventListener('click',()=>playing?pause():play());
  el('motion-replay').addEventListener('click',()=>{pause();render(reduced.matches?1100:0);play();});
  el('motion-prev').addEventListener('click',()=>jump(indexAt(time)-1));
  el('motion-next').addEventListener('click',()=>jump(indexAt(time)+1));
  el('motion-scrub').addEventListener('input',e=>{pause();render(Number(e.target.value)/1000*total());});
  el('motion-steps').addEventListener('click',e=>{const b=e.target.closest('[data-step]');if(b)jump(Number(b.dataset.step));});
  function preference(){pause();el('motion-play').disabled=reduced.matches;el('motion-reduced').textContent=reduced.matches?'Reduced motion is enabled. Use the step buttons or scrubber to inspect static states.':'Offline illustration. Play, pause, replay, step, or scrub; playback stops at the end.';render(time);}
  reduced.addEventListener('change',preference);
  addEventListener('resize',()=>render(time));addEventListener('beforeprint',pause);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();});
  select();preference();
})();
