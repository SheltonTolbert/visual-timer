(function(){
  // -------- Utilities --------
  const $ = sel => document.querySelector(sel);
  const $$ = sel => [...document.querySelectorAll(sel)];
  const byId = id => document.getElementById(id);
  const fmt = s => String(s).padStart(2, '0');
  const uuid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
  const speak = txt => { try { if (!state.prefs.speak) return; const u = new SpeechSynthesisUtterance(txt); speechSynthesis.cancel(); speechSynthesis.speak(u);} catch(e){} };
  const vibrate = pat => { try { if (!state.prefs.vibrate) return; navigator.vibrate?.(pat || 100); } catch(e){} };
  const live = txt => { const n = byId('liveRegion'); n.textContent = txt; };
  const now = () => Date.now();
  const deepClone = obj => JSON.parse(JSON.stringify(obj));

  function secondsToHMS(sec){ sec = Math.max(0, Math.floor(sec)); const h = Math.floor(sec/3600), m = Math.floor((sec%3600)/60), s = sec%60; return (h? fmt(h)+':':'')+fmt(m)+':'+fmt(s); }

  function getTotalSeconds(blocks){ return blocks.length? blocks[blocks.length-1].atSeconds : 0; }

  // -------- Storage (local) --------
  const LS_TIMERS = 'cbtimers.v1';
  const LS_PREFS  = 'cbprefs.v1';
  function loadTimers(){ try { return JSON.parse(localStorage.getItem(LS_TIMERS)||'[]'); } catch { return []; } }
  function saveTimers(list){ localStorage.setItem(LS_TIMERS, JSON.stringify(list)); }
  function loadPrefs(){ const d = { speak:true, vibrate:false, wake:true, theme:'system' }; try { return Object.assign(d, JSON.parse(localStorage.getItem(LS_PREFS)||'{}')); } catch { return d; } }
  function savePrefs(p){ localStorage.setItem(LS_PREFS, JSON.stringify(p)); }

  // -------- Firebase stub (wire later) --------
  async function initFirebase(){ /*
    // Example: paste your config then call this and swap storage to Firestore
    import('https://www.gstatic.com/firebasejs/10.12.3/firebase-app.js').then(async ({ initializeApp })=>{
      const app = initializeApp(window.__FIREBASE_CONFIG);
      // ... import auth, firestore and wire into store
    });
  */ }

  // -------- App State --------
  const state = {
    timers: loadTimers(),
    prefs: loadPrefs(),
    route: { page: 'list', id:null },
  };

  // Draft timers cache (for unsaved edits)
  const drafts = {};

  // Seed sample if empty
  if(state.timers.length === 0){ byId('emptyState').style.display = 'block'; }

  // -------- Validation --------
  function validateTimer(timer){
    const errors = [];
    const blocks = deepClone(timer.blocks).sort((a,b)=>a.atSeconds-b.atSeconds);
    if (blocks.length===0) errors.push('Add at least one block.');
    if (blocks[0]?.atSeconds !== 0) errors.push('First block must start at 0 seconds.');
    for(let i=0;i<blocks.length;i++){
      const b = blocks[i];
      if (b.atSeconds < 0) errors.push(`Block ${i+1}: time cannot be negative.`);
      if (!/^#?[0-9A-Fa-f]{6}$/.test(b.colorHex)) errors.push(`Block ${i+1}: invalid color.`);
      if (i>0 && b.atSeconds === blocks[i-1].atSeconds) errors.push(`Duplicate time at ${b.atSeconds}s.`);
      if (i>0 && b.atSeconds < blocks[i-1].atSeconds) errors.push('Blocks must be in ascending time order.');
    }
    return { ok: errors.length===0, errors };
  }

  // -------- Router --------
  function go(page, id){ state.route = { page, id: id||null }; location.hash = '#/'+page + (id?('/'+id):''); }
  function parseHash(){ const h = location.hash.slice(2).split('/'); const page = h[0]||'list'; const id = h[1]||null; return { page, id } }
  window.addEventListener('hashchange', render);

  // -------- Render --------
  function setTheme(theme){
    const t = theme || state.prefs.theme || 'system';
    if(t==='system'){
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', t);
    }
  }

  function renderList(){
    const listEl = byId('timerList'); listEl.innerHTML = '';
    const timers = state.timers.slice().sort((a,b)=> a.name.localeCompare(b.name));
    if (timers.length===0){ byId('emptyState').style.display = 'block'; return; }
    byId('emptyState').style.display = 'none';
    for (const t of timers){
      const total = getTotalSeconds(t.blocks);
      const row = document.createElement('button');
      row.className = 'card row'; row.setAttribute('role','listitem'); row.style.textAlign='left';
      row.innerHTML = `
        <div class="stack" style="flex:1">
          <div style="font-weight:700">${escapeHtml(t.name)}</div>
          <div class="small muted">${t.blocks.length} block${t.blocks.length>1?'s':''} • ${secondsToHMS(total)}</div>
        </div>
        <div class="row">
          <button class="btn" data-edit="${t.id}">Edit</button>
          <span class="pill">Run ▶</span>
        </div>`;
      row.addEventListener('click', e=>{ if(e.target?.dataset?.edit){ go('edit', t.id); } else { go('run', t.id); } });
      listEl.appendChild(row);
    }
  }
  function getOrCreateDraft(id){
    let t = state.timers.find(x=>x.id===id);
    if (t) return t;
    const newId = id || uuid();
    if (!drafts[newId]) {
      drafts[newId] = { id: newId, name:'', blocks:[{ atSeconds:0, colorHex:'#FFD400', label: byId('defaultLabel').value||'Start'}], createdAt:now(), updatedAt:now() };
    }
    return drafts[newId];
  }

  function renderEdit(id){
    const timer = getOrCreateDraft(id);
    byId('timerName').value = timer.name || '';
    byId('deleteTimerBtn').style.display = state.timers.some(x=>x.id===id)? 'inline-block':'none';
    // Render rows
    const blocksEl = byId('blocks'); blocksEl.innerHTML='';
    timer.blocks.forEach((b, idx)=> blocksEl.appendChild(blockRow(b, idx, id)) );
    // Bind buttons
    byId('addBlockBtn').onclick = ()=>{ updateFromRows(timer); timer.blocks.push({ atSeconds: getTotalSeconds(timer.blocks)+60, colorHex:'#5b8cff', label: byId('defaultLabel').value||'' }); renderEdit(timer.id); };
    byId('sortBlocksBtn').onclick = ()=>{ updateFromRows(timer); timer.blocks.sort((a,b)=>a.atSeconds-b.atSeconds); renderEdit(timer.id); };
    byId('validateBtn').onclick = ()=>{ updateFromRows(timer); const v = validateTimer(timer); const msg = byId('validateMsg'); msg.textContent = v.ok? 'Looks good ✅' : v.errors.join(' '); msg.className = 'small ' + (v.ok? 'ok':'error'); };
    byId('saveTimerBtn').onclick = ()=>{ updateFromRows(timer); const v = validateTimer(timer); if(!v.ok){ alert('Fix errors before saving:\n'+v.errors.join('\n')); return; } saveTimer(timer); go('list'); };
    byId('deleteTimerBtn').onclick = ()=>{ if (confirm('Delete this timer?')){ state.timers = state.timers.filter(x=>x.id!==id); saveTimers(state.timers);
    try{ delete drafts[timer.id]; }catch{} go('list'); } };
    byId('backFromEdit').onclick = ()=> go('list');

    function blockRow(block, idx, tid){
      const row = document.createElement('div'); row.className = 'block-row'; row.dataset.index = idx;
      row.innerHTML = `
        <input aria-label="Time (seconds)" type="number" min="0" step="1" value="${block.atSeconds}" />
        <input aria-label="Color" type="color" value="${normalizeHex(block.colorHex)}" />
        <input aria-label="Label (optional)" type="text" placeholder="Label" value="${escapeHtml(block.label||'')}" />
        <button class="btn" title="Remove">✕</button>`;
      row.children[3].addEventListener('click', ()=>{ const t = state.timers.find(x=>x.id===tid) || timer; const index = +row.dataset.index; t.blocks.splice(index,1); if(t.blocks.length===0) t.blocks.push({atSeconds:0,colorHex:'#FFD400',label:'Start'}); renderEdit(t.id); });
      return row;
    }

    function updateFromRows(timer){
      const rows = $$('#blocks .block-row');
      timer.blocks = rows.map(r=>({
        atSeconds: Math.max(0, parseInt(r.children[0].value||'0',10)),
        colorHex: normalizeHex(r.children[1].value||'#000000'),
        label: r.children[2].value||''
      }));
      timer.updatedAt = now();
    }
  }

  function saveTimer(timer){
    const existing = state.timers.findIndex(x=>x.id===timer.id);
    if (existing >= 0) state.timers[existing] = timer; else state.timers.push(timer);
    saveTimers(state.timers);
    renderList();
  }

  // Escape HTML helper
  function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[c])); }
  function normalizeHex(h){ h = (h||'').trim(); if(!h) return '#000000'; if(h[0] !== '#') h = '#'+h; return h.slice(0,7); }

  // -------- Run engine --------
  const Engine = (()=>{
    let timer=null, tick=null, startMs=0, pausedAt=0, currentIdx=0, activeId=null, wakeLock=null;

    async function requestWake(){ if(!state.prefs.wake) return; try{ wakeLock = await navigator.wakeLock?.request('screen'); wakeLock?.addEventListener('release', ()=> console.log('WakeLock released')); }catch(e){ console.warn('WakeLock failed', e);} }
    async function releaseWake(){ try{ await wakeLock?.release?.(); }catch{} finally { wakeLock=null; } }

    function scheduleNext(t){
      clearTimers();
      const blocks = t.blocks.slice().sort((a,b)=>a.atSeconds-b.atSeconds);
      const total = getTotalSeconds(blocks);
      const elapsed = getElapsed();
      // Find current index by elapsed
      currentIdx = 0;
      while(currentIdx < blocks.length-1 && elapsed >= blocks[currentIdx+1].atSeconds){ currentIdx++; }
      applyBlock(blocks[currentIdx], t);
      // Schedule the next change
      if(currentIdx < blocks.length-1){
        const nextAt = blocks[currentIdx+1].atSeconds*1000 - getElapsedMs();
        timer = setTimeout(()=>{ currentIdx++; applyBlock(blocks[currentIdx], t); scheduleNext(t); }, Math.max(0,nextAt));
      } else {
        // End watcher to fire done when crossing total
        timer = setTimeout(()=>{ done(t); }, Math.max(0, total*1000 - getElapsedMs()));
      }
      // UI ticker
      tick = setInterval(()=> updateRunUI(t), 250);
    }

    function applyBlock(b, t){
      const root = byId('runRoot');
      root.style.background = normalizeHex(b.colorHex);
      const title = byId('runTitle');
      title.textContent = `${t.name||'Timer'} — ${b.label||''}`.trim();
      const say = b.label || `Change`; speak(say); vibrate([120,60,120]); live(`Block: ${say}`);
      updateRunUI(t);
    }

    function updateRunUI(t){
      const blocks = t.blocks.slice().sort((a,b)=>a.atSeconds-b.atSeconds);
      const elapsed = getElapsed();
      const total = getTotalSeconds(blocks);
      // find next change
      let next = total; for(let i=0;i<blocks.length;i++){ if(blocks[i].atSeconds>elapsed){ next = blocks[i].atSeconds; break; } }
      const remainingToNext = Math.max(0, Math.floor(next - elapsed));
      byId('runInfo').textContent = `Elapsed ${secondsToHMS(elapsed)} • Next change in ${secondsToHMS(remainingToNext)} • Total ${secondsToHMS(total)}`;
    }

    function start(t){ activeId = t.id; startMs = now(); pausedAt = 0; scheduleNext(t); requestWake(); }
    function pause(){ if(pausedAt) return; pausedAt = now(); clearTimers(); releaseWake(); byId('runInfo').textContent='Paused'; live('Paused'); }
    function resume(t){ if(!pausedAt) return; const pausedDur = now()-pausedAt; startMs += pausedDur; pausedAt = 0; scheduleNext(t); requestWake(); }
    function reset(t){ clearTimers(); startMs = now(); pausedAt = 0; currentIdx = 0; applyBlock(t.blocks[0], t); updateRunUI(t); releaseWake(); }
    function done(t){ clearTimers(); speak('Done'); vibrate([200,100,200,100,200]); live('Timer finished'); releaseWake(); }

    function getElapsedMs(){ return Math.max(0, (pausedAt||now()) - startMs); }
    function getElapsed(){ return Math.floor(getElapsedMs()/1000); }
    function clearTimers(){ if(timer){ clearTimeout(timer); timer=null; } if(tick){ clearInterval(tick); tick=null; } }

    // visibility handling to re-acquire wake lock
    document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState==='visible' && activeId && !pausedAt){ requestWake(); } });

    function isRunning(){ return !!activeId && !pausedAt; }
    function isPaused(){ return !!activeId && !!pausedAt; }
    function toggle(t){ if(!activeId){ start(t); } else if(pausedAt){ resume(t); } else { pause(); } }

    return { start, pause, resume, reset };
  })();

  // -------- Event wiring --------
  byId('addTimerBtn').onclick = ()=> go('edit');
  byId('createSampleBtn').onclick = ()=>{
    const t = { id: uuid(), name:'Pomodoro 25/5', blocks:[
      { atSeconds:0, colorHex:'#2ecc71', label:'Focus' },
      { atSeconds:25*60, colorHex:'#ffb400', label:'Break' },
      { atSeconds:30*60, colorHex:'#2ecc71', label:'Focus' },
      { atSeconds:55*60, colorHex:'#ffb400', label:'Break' },
      { atSeconds:60*60, colorHex:'#e7002f', label:'Done' }
    ], createdAt:now(), updatedAt:now() };
    saveTimer(t); go('list');
  };

  byId('settingsBtn').onclick = ()=> go('settings');
  byId('backFromSettings').onclick = ()=> go('list');

  // Preferences
  function loadPrefControls(){
    byId('prefSpeak').checked = !!state.prefs.speak;
    byId('prefVibrate').checked = !!state.prefs.vibrate;
    byId('prefWake').checked = !!state.prefs.wake;
    byId('prefTheme').value = state.prefs.theme || 'system';
  }
  function savePrefControls(){
    state.prefs.speak = byId('prefSpeak').checked;
    state.prefs.vibrate = byId('prefVibrate').checked;
    state.prefs.wake = byId('prefWake').checked;
    state.prefs.theme = byId('prefTheme').value;
    savePrefs(state.prefs);
    setTheme();
  }
  $$('#prefSpeak, #prefVibrate, #prefWake, #prefTheme').forEach(el=> el.addEventListener('change', savePrefControls));

  // Run page controls
  byId('backFromRun').onclick = ()=> go('list');
  byId('startBtn').onclick = ()=>{ const t = state.timers.find(x=>x.id===state.route.id); if(!t) return; Engine.start(t); };
  byId('pauseBtn').onclick = ()=>{ Engine.pause(); };
  byId('resetBtn').onclick = ()=>{ const t = state.timers.find(x=>x.id===state.route.id); if(!t) return; Engine.reset(t); };
  byId('fullscreenBtn').onclick = ()=>{ const el = byId('runRoot'); if(document.fullscreenElement){ document.exitFullscreen(); } else { el.requestFullscreen?.(); } };

  // Toggle start/pause by clicking anywhere on the run view (except controls)
  byId('runRoot').addEventListener('click', (e)=>{
    if (e.target.closest('.run-panel') || e.target.closest('button')) return; // ignore clicks on controls
    const t = state.timers.find(x=>x.id===state.route.id); if(!t) return;
    Engine.toggle(t);
  });

  // Theme toggle btn
  byId('themeBtn').onclick = ()=>{
    const order = ['system','light','dark'];
    const idx = order.indexOf(state.prefs.theme||'system');
    state.prefs.theme = order[(idx+1)%order.length];
    savePrefs(state.prefs); setTheme();
  };

  // PWA install prompt (optional best-effort)
  let deferredPrompt=null; window.addEventListener('beforeinstallprompt', e=>{ e.preventDefault(); deferredPrompt=e; byId('installBtn').hidden=false; });
  byId('installBtn').onclick = async ()=>{ try{ await deferredPrompt.prompt(); }catch{} };

  // -------- Page switcher --------
  function show(pageId){ $$('.page').forEach(p=>p.classList.remove('active')); byId('page-'+pageId).classList.add('active'); }

  function render(){
    state.route = parseHash();
    setTheme(state.prefs.theme);
    if(state.route.page==='list'){ show('list'); renderList(); }
    else if(state.route.page==='edit'){ show('edit'); renderEdit(state.route.id); }
    else if(state.route.page==='run'){
      const t = state.timers.find(x=>x.id===state.route.id); if(!t){ alert('Timer not found'); go('list'); return; }
      show('run'); byId('runRoot').style.background = normalizeHex(t.blocks[0]?.colorHex||'#000'); byId('runTitle').textContent = t.name; byId('runInfo').textContent='Ready';
    }
    else if(state.route.page==='settings'){ show('settings'); loadPrefControls(); }
    else { go('list'); }
  }

  // Init
  render();

})();