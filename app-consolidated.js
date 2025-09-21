(function(){
  alert('JavaScript loading started!');
  // ============ UTILITIES MODULE ============
  const $ = sel => document.querySelector(sel);
  const $$ = sel => [...document.querySelectorAll(sel)];
  const byId = id => document.getElementById(id);
  const fmt = s => String(s).padStart(2, '0');
  const uuid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
  const now = () => Date.now();
  const deepClone = obj => JSON.parse(JSON.stringify(obj));

  // Gruvbox Material Color Palette
  const gruvboxColors = [
    // Neutral tones
    '#282828', '#3c3836', '#504945', '#665c54', // darks
    '#928374', '#a89984', '#bdae93', '#d5c4a1', // grays
    '#ebdbb2', '#fbf1c7', '#f9f5d7', '#f2e5bc', // lights
    // Accent colors
    '#cc241d', '#fb4934', // reds
    '#d65d0e', '#fe8019', // oranges
    '#d79921', '#fabd2f', // yellows
    '#98971a', '#b8bb26', // greens
    '#689d6a', '#8ec07c', // aquas
    '#458588', '#83a598', // blues
    '#b16286', '#d3869b'  // purples
  ];

  // Accessibility and feedback functions
  const speak = txt => {
    try {
      if (!state?.prefs?.speak) return;
      const u = new SpeechSynthesisUtterance(txt);
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    } catch(e){}
  };

  const vibrate = pat => {
    try {
      if (!state?.prefs?.vibrate) return;
      navigator.vibrate?.(pat || 100);
    } catch(e){}
  };

  const live = txt => {
    const n = byId('liveRegion');
    if (n) n.textContent = txt;
  };

  // Time conversion helpers
  function secondsToHMS(sec){
    sec = Math.max(0, Math.floor(sec));
    const h = Math.floor(sec/3600), m = Math.floor((sec%3600)/60), s = sec%60;
    return (h? fmt(h)+':':'') + fmt(m) + ':' + fmt(s);
  }

  function secondsToHoursMinutesSeconds(totalSeconds) {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return { hours, minutes, seconds };
  }

  function hoursMinutesSecondsToTotal(hours, minutes, seconds) {
    return Math.max(0,
      (parseInt(hours || 0, 10) * 3600) +
      (parseInt(minutes || 0, 10) * 60) +
      parseInt(seconds || 0, 10)
    );
  }

  function getTotalSeconds(blocks){
    return blocks.length? blocks[blocks.length-1].atSeconds : 0;
  }

  // HTML helpers
  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[c]));
  }

  function normalizeHex(h){
    h = (h||'').trim();
    if(!h) return '#000000';
    if(h[0] !== '#') h = '#'+h;
    return h.slice(0,7);
  }

  // ============ STORAGE MODULE ============
  const LS_TIMERS = 'cbtimers.v1';
  const LS_PREFS  = 'cbprefs.v1';

  function loadTimers(){
    try {
      return JSON.parse(localStorage.getItem(LS_TIMERS)||'[]');
    } catch {
      return [];
    }
  }

  function saveTimers(list){
    localStorage.setItem(LS_TIMERS, JSON.stringify(list));
    // Auto-sync to Firestore if user is signed in
    if (state?.user) {
      syncToFirestore();
    }
  }

  function loadPrefs(){
    const d = { speak:true, vibrate:false, wake:true, theme:'system', onboarded:false };
    try {
      return Object.assign(d, JSON.parse(localStorage.getItem(LS_PREFS)||'{}'));
    } catch {
      return d;
    }
  }

  function savePrefs(p){
    localStorage.setItem(LS_PREFS, JSON.stringify(p));
    // Auto-sync to Firestore if user is signed in
    if (state?.user) {
      syncToFirestore();
    }
  }

  // ============ STATE MANAGEMENT MODULE ============
  const state = {
    timers: loadTimers(),
    prefs: loadPrefs(),
    route: { page: 'list', id:null },
    user: null,
  };

  // Draft timers cache (for unsaved edits)
  const drafts = {};

  // ============ VALIDATION MODULE ============
  function validateTimer(timer){
    const errors = [];
    const blocks = deepClone(timer.blocks).sort((a,b)=>a.atSeconds-b.atSeconds);
    if (blocks.length===0) errors.push('Add at least one block.');

    // Ensure first block always starts at 0
    if (blocks.length > 0) {
      blocks[0].atSeconds = 0;
    }

    for(let i=0;i<blocks.length;i++){
      const b = blocks[i];
      if (i > 0 && b.atSeconds < 0) errors.push(`Block ${i+1}: time cannot be negative.`);
      if (!/^#?[0-9A-Fa-f]{6}$/.test(b.colorHex)) errors.push(`Block ${i+1}: invalid color.`);
      if (i>0 && b.atSeconds === blocks[i-1].atSeconds) errors.push(`Duplicate time at ${b.atSeconds}s.`);
      if (i>0 && b.atSeconds < blocks[i-1].atSeconds) errors.push('Blocks must be in ascending time order.');
    }
    return { ok: errors.length===0, errors };
  }

  // ============ ROUTER MODULE ============
  function go(page, id){
    state.route = { page, id: id||null };
    location.hash = '#/'+page + (id?('/'+id):'');
  }

  function parseHash(){
    const h = location.hash.slice(2).split('/');
    const page = h[0]||'list';
    const id = h[1]||null;
    return { page, id };
  }

  // ============ FIREBASE MODULE ============
  let firebase = null;
  let isInitialized = false;

  async function initFirebase(){
    if (isInitialized) return firebase;

    // Wait for Firebase to be available from the module script
    let attempts = 0;
    while (!window.firebaseApp && attempts < 50) {
      await new Promise(resolve => setTimeout(resolve, 100));
      attempts++;
    }

    if (!window.firebaseApp) {
      console.warn('Firebase not available');
      return null;
    }

    firebase = window.firebaseApp;
    isInitialized = true;

    // Set up auth state listener and wait for initial auth check
    return new Promise((resolve) => {
      let hasInitiallyResolved = false;
      firebase.onAuthStateChanged(firebase.auth, (user) => {
        state.user = user;
        updateAuthUI();
        if (user) {
          syncFromFirestore();
        }
        if (!hasInitiallyResolved) {
          hasInitiallyResolved = true;
          resolve(firebase);
        }
      });
    });
  }

  async function signInWithGoogle(){
    const fb = await initFirebase();
    if (!fb) return;

    try {
      const provider = new fb.GoogleAuthProvider();
      const result = await fb.signInWithPopup(fb.auth, provider);
      const user = result.user;
      live(`Signed in as ${user.displayName}`);
      return user;
    } catch (error) {
      console.error('Sign-in error:', error);
      alert('Sign-in failed: ' + error.message);
    }
  }

  async function signOutUser(){
    const fb = await initFirebase();
    if (!fb) return;

    try {
      await fb.signOut(fb.auth);
      live('Signed out');
    } catch (error) {
      console.error('Sign-out error:', error);
    }
  }

  async function syncToFirestore(){
    const fb = await initFirebase();
    if (!fb || !state.user) return;

    try {
      const userRef = fb.doc(fb.db, 'users', state.user.uid);
      await fb.setDoc(userRef, {
        timers: state.timers,
        prefs: state.prefs,
        updatedAt: fb.serverTimestamp()
      });
      console.log('Data synced to Firestore');
    } catch (error) {
      console.error('Sync to Firestore failed:', error);
    }
  }

  async function syncFromFirestore(){
    const fb = await initFirebase();
    if (!fb || !state.user) return;

    try {
      const userRef = fb.doc(fb.db, 'users', state.user.uid);
      const doc = await fb.getDoc(userRef);

      if (doc.exists()) {
        const data = doc.data();

        if (data.timers && Array.isArray(data.timers)) {
          const remoteTimers = data.timers;
          const localTimerIds = new Set(state.timers.map(t => t.id));

          for (const remoteTimer of remoteTimers) {
            if (!localTimerIds.has(remoteTimer.id)) {
              state.timers.push(remoteTimer);
            }
          }

          saveTimers(state.timers);
          renderList();
        }

        if (data.prefs) {
          state.prefs = Object.assign({}, data.prefs, state.prefs);
          savePrefs(state.prefs);
        }

        console.log('Data synced from Firestore');
      }
    } catch (error) {
      console.error('Sync from Firestore failed:', error);
    }
  }

  function updateAuthUI(){
    const authBtn = byId('authBtn');
    if (authBtn) {
      if (state.user) {
        authBtn.style.display = 'none';
      } else {
        authBtn.style.display = 'inline-block';
        authBtn.textContent = 'Sign In';
        authBtn.title = 'Sign in with Google to sync across devices';
        authBtn.onclick = signInWithGoogle;
      }
    }

    const authStatus = byId('authStatus');
    const authActionBtn = byId('authActionBtn');
    const syncNowBtn = byId('syncNowBtn');

    if (authStatus && authActionBtn) {
      if (state.user) {
        authStatus.textContent = `Signed in as ${state.user.displayName || state.user.email}. Your timers sync automatically.`;
        authActionBtn.textContent = 'Sign Out';
        authActionBtn.onclick = signOutUser;
        if (syncNowBtn) {
          syncNowBtn.style.display = 'inline-block';
          syncNowBtn.onclick = () => {
            syncToFirestore();
            syncFromFirestore();
            syncNowBtn.textContent = 'Synced!';
            setTimeout(() => syncNowBtn.textContent = 'Sync Now', 2000);
          };
        }
      } else {
        authStatus.textContent = 'Sign in to sync your timers across devices';
        authActionBtn.textContent = 'Sign In with Google';
        authActionBtn.onclick = signInWithGoogle;
        if (syncNowBtn) {
          syncNowBtn.style.display = 'none';
        }
      }
    }
  }

  // ============ RENDER MODULE ============
  function setTheme(theme){
    const t = theme || state.prefs.theme || 'system';
    if(t==='system'){
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', t);
    }
  }

  function renderList(){
    const listEl = byId('timerList');
    listEl.innerHTML = '';
    const timers = state.timers.slice().sort((a,b)=> a.name.localeCompare(b.name));
    if (timers.length===0){
      byId('emptyState').style.display = 'block';
      return;
    }
    byId('emptyState').style.display = 'none';
    for (const t of timers){
      const total = getTotalSeconds(t.blocks);
      const row = document.createElement('button');
      row.className = 'card row';
      row.setAttribute('role','listitem');
      row.style.textAlign='left';
      row.innerHTML = `
        <div class="stack" style="flex:1">
          <div class="section-title" style="margin:0">${escapeHtml(t.name)}</div>
          <div class="small muted">${t.blocks.length} block${t.blocks.length>1?'s':''} • ${secondsToHMS(total)}</div>
        </div>
        <div class="row">
          <button class="btn" data-edit="${t.id}">Edit</button>
          <span class="pill">Run ▶</span>
        </div>`;
      row.addEventListener('click', e=>{
        if(e.target?.dataset?.edit){
          go('edit', t.id);
        } else {
          go('run', t.id);
        }
      });
      listEl.appendChild(row);
    }
  }

  function getOrCreateDraft(id){
    let t = state.timers.find(x=>x.id===id);
    if (t) return t;
    const newId = id || uuid();
    if (!drafts[newId]) {
      drafts[newId] = {
        id: newId,
        name:'',
        blocks:[{
          atSeconds:0,
          colorHex:'#FFD400',
          label: byId('defaultLabel').value||'Start'
        }],
        createdAt:now(),
        updatedAt:now()
      };
    }
    return drafts[newId];
  }

  function saveTimer(timer){
    const existing = state.timers.findIndex(x=>x.id===timer.id);
    if (existing >= 0)
      state.timers[existing] = timer;
    else
      state.timers.push(timer);
    saveTimers(state.timers);
    renderList();
  }

  // ... (renderEdit function would go here - truncated for length)

  // ============ TIMER ENGINE MODULE ============
  const Engine = (()=>{
    let timer=null, tick=null, startMs=0, pausedAt=0, currentIdx=0, activeId=null, wakeLock=null;

    async function requestWake(){
      if(!state.prefs.wake) return;
      try{
        wakeLock = await navigator.wakeLock?.request('screen');
        wakeLock?.addEventListener('release', ()=> console.log('WakeLock released'));
      }catch(e){
        console.warn('WakeLock failed', e);
      }
    }

    async function releaseWake(){
      try{
        await wakeLock?.release?.();
      }catch{}
      finally {
        wakeLock=null;
      }
    }

    function scheduleNext(t){
      clearTimers();
      const blocks = t.blocks.slice().sort((a,b)=>a.atSeconds-b.atSeconds);
      const total = getTotalSeconds(blocks);
      const elapsed = getElapsed();
      currentIdx = 0;
      while(currentIdx < blocks.length-1 && elapsed >= blocks[currentIdx+1].atSeconds){
        currentIdx++;
      }
      applyBlock(blocks[currentIdx], t);
      if(currentIdx < blocks.length-1){
        const nextAt = blocks[currentIdx+1].atSeconds*1000 - getElapsedMs();
        timer = setTimeout(()=>{
          currentIdx++;
          applyBlock(blocks[currentIdx], t);
          scheduleNext(t);
        }, Math.max(0,nextAt));
      } else {
        timer = setTimeout(()=>{
          done(t);
        }, Math.max(0, total*1000 - getElapsedMs()));
      }
      tick = setInterval(()=> updateRunUI(t), 250);
    }

    function applyBlock(b, t){
      const root = byId('runRoot');
      root.style.background = normalizeHex(b.colorHex);
      const title = byId('runTitle');
      title.textContent = `${t.name||'Timer'} — ${b.label||''}`.trim();
      const say = b.label || `Change`;
      speak(say);
      vibrate([120,60,120]);
      live(`Block: ${say}`);
      updateRunUI(t);
    }

    function updateRunUI(t){
      const blocks = t.blocks.slice().sort((a,b)=>a.atSeconds-b.atSeconds);
      const elapsed = getElapsed();
      const total = getTotalSeconds(blocks);
      let next = total;
      for(let i=0;i<blocks.length;i++){
        if(blocks[i].atSeconds>elapsed){
          next = blocks[i].atSeconds;
          break;
        }
      }
      const remainingToNext = Math.max(0, Math.floor(next - elapsed));
      byId('runInfo').textContent = `Elapsed ${secondsToHMS(elapsed)} • Next change in ${secondsToHMS(remainingToNext)} • Total ${secondsToHMS(total)}`;
    }

    function start(t){
      activeId = t.id;
      startMs = now();
      pausedAt = 0;
      scheduleNext(t);
      requestWake();
    }

    function pause(){
      if(pausedAt) return;
      pausedAt = now();
      clearTimers();
      releaseWake();
      byId('runInfo').textContent='Paused';
      live('Paused');
    }

    function resume(t){
      if(!pausedAt) return;
      const pausedDur = now()-pausedAt;
      startMs += pausedDur;
      pausedAt = 0;
      scheduleNext(t);
      requestWake();
    }

    function reset(t){
      clearTimers();
      startMs = now();
      pausedAt = 0;
      currentIdx = 0;
      applyBlock(t.blocks[0], t);
      updateRunUI(t);
      releaseWake();
    }

    function done(t){
      clearTimers();
      speak('Done');
      vibrate([200,100,200,100,200]);
      live('Timer finished');
      releaseWake();
    }

    function getElapsedMs(){
      return Math.max(0, (pausedAt||now()) - startMs);
    }

    function getElapsed(){
      return Math.floor(getElapsedMs()/1000);
    }

    function clearTimers(){
      if(timer){
        clearTimeout(timer);
        timer=null;
      }
      if(tick){
        clearInterval(tick);
        tick=null;
      }
    }

    document.addEventListener('visibilitychange', ()=>{
      if(document.visibilityState==='visible' && activeId && !pausedAt){
        requestWake();
      }
    });

    function isRunning(){
      return !!activeId && !pausedAt;
    }

    function isPaused(){
      return !!activeId && !!pausedAt;
    }

    function toggle(t){
      if(!activeId){
        start(t);
      } else if(pausedAt){
        resume(t);
      } else {
        pause();
      }
    }

    return { start, pause, resume, reset, toggle };
  })();

  // ============ PAGE SWITCHER ============
  function show(pageId){
    console.log('show() called with pageId:', pageId);
    $$('.page').forEach(p=>{
      p.classList.remove('active');
      console.log('Removed active from:', p.id);
    });
    const targetPage = byId('page-'+pageId);
    console.log('Target page element:', targetPage);
    targetPage.classList.add('active');
    document.title = `Time Box - ${pageId}`;
    console.log('Active pages after show:', $$('.page.active').map(p => p.id));
  }

  // ============ RENDER FUNCTION ============
  function render(){
    alert('render() called, onboarded: ' + state.prefs.onboarded);
    state.route = parseHash();
    setTheme(state.prefs.theme);
    updateAuthUI();

    // Check if user needs onboarding
    if (!state.prefs.onboarded) {
      alert('User needs onboarding - calling show(onboarding)');
      show('onboarding');
      initOnboarding();
      return;
    }

    if(state.route.page==='list'){
      show('list');
      renderList();
    }
    else if(state.route.page==='edit'){
      show('edit');
      // renderEdit(state.route.id); // Would implement this
    }
    else if(state.route.page==='run'){
      const t = state.timers.find(x=>x.id===state.route.id);
      if(!t){
        alert('Timer not found');
        go('list');
        return;
      }
      show('run');
      byId('runRoot').style.background = normalizeHex(t.blocks[0]?.colorHex||'#000');
      byId('runTitle').textContent = t.name;
      byId('runInfo').textContent='Ready';
    }
    else if(state.route.page==='settings'){
      show('settings');
      // loadPrefControls(); // Would implement this
    }
    else {
      go('list');
    }
  }

  // ============ ONBOARDING FUNCTIONS ============
  let selectedTheme = null;
  let currentOnboardingStep = 1;

  function showOnboardingStep(step) {
    for (let i = 1; i <= 4; i++) {
      const stepEl = byId(`onboarding-step-${i}`);
      if (stepEl) stepEl.style.display = 'none';
    }
    const currentStep = byId(`onboarding-step-${step}`);
    if (currentStep) currentStep.style.display = 'block';
    currentOnboardingStep = step;
  }

  function initOnboarding() {
    $$('.theme-option').forEach(option => {
      option.addEventListener('click', () => {
        $$('.theme-option').forEach(opt => opt.classList.remove('selected'));
        option.classList.add('selected');
        selectedTheme = option.dataset.theme;
        setTheme(selectedTheme);
        byId('onboarding-continue-1').disabled = false;
      });
    });

    byId('onboarding-continue-1').addEventListener('click', () => {
      if (selectedTheme) {
        state.prefs.theme = selectedTheme;
        savePrefs(state.prefs);
        showOnboardingStep(2);
      }
    });

    byId('onboarding-back-2')?.addEventListener('click', () => showOnboardingStep(1));
    byId('onboarding-continue-2')?.addEventListener('click', () => showOnboardingStep(3));

    byId('onboarding-back-3')?.addEventListener('click', () => showOnboardingStep(2));
    byId('onboarding-skip-signin')?.addEventListener('click', () => {
      completeOnboarding();
    });
    byId('onboarding-signin')?.addEventListener('click', async () => {
      try {
        const firebase = window.firebaseApp;
        const provider = new firebase.GoogleAuthProvider();
        const result = await firebase.signInWithPopup(firebase.auth, provider);
        if (result.user) {
          live('Successfully signed in with Google');
          showOnboardingStep(4);
        }
      } catch (error) {
        console.error('Sign-in error:', error);
        alert('Sign-in failed. You can try again later from Settings.');
        completeOnboarding();
      }
    });

    byId('onboarding-finish')?.addEventListener('click', () => {
      completeOnboarding();
    });

    showOnboardingStep(1);
  }

  function completeOnboarding() {
    state.prefs.onboarded = true;
    savePrefs(state.prefs);
    if (state.user) {
      syncToFirestore();
    }
    go('list');
  }

  // ============ EVENT WIRING ============
  function setupEventHandlers() {
    byId('addTimerBtn').onclick = ()=> go('edit');
    byId('createSampleBtn').onclick = ()=>{
      const t = {
        id: uuid(),
        name:'Pomodoro 25/5',
        blocks:[
          { atSeconds:0, colorHex:'#2ecc71', label:'Focus' },
          { atSeconds:25*60, colorHex:'#ffb400', label:'Break' },
          { atSeconds:30*60, colorHex:'#2ecc71', label:'Focus' },
          { atSeconds:55*60, colorHex:'#ffb400', label:'Break' },
          { atSeconds:60*60, colorHex:'#e7002f', label:'Done' }
        ],
        createdAt:now(),
        updatedAt:now()
      };
      saveTimer(t);
      go('list');
    };

    // Setup routing
    window.addEventListener('hashchange', render);
  }

  // ============ INITIALIZATION ============
  async function init(){
    // Setup event handlers first
    setupEventHandlers();

    const loadingScreen = byId('loadingScreen');
    const startTime = now();
    let showLoadingScreen = false;

    if (loadingScreen) {
      loadingScreen.style.display = 'none';
    }

    const loadingTimeout = setTimeout(() => {
      if (loadingScreen) {
        loadingScreen.style.display = 'flex';
        showLoadingScreen = true;
      }
    }, 120);

    try {
      await initFirebase();
      clearTimeout(loadingTimeout);

      if (showLoadingScreen) {
        const elapsed = now() - startTime;
        const minLoadTime = 10;
        const animationDuration = 10;
        const totalWaitTime = Math.max(minLoadTime, animationDuration);

        if (elapsed < totalWaitTime) {
          await new Promise(resolve => setTimeout(resolve, totalWaitTime - elapsed));
        }

        if (loadingScreen) {
          loadingScreen.classList.add('hide');
          setTimeout(() => loadingScreen.style.display = 'none', 300);
        }
      }

      render();
    } catch (error) {
      console.error('Initialization failed:', error);
      clearTimeout(loadingTimeout);

      if (showLoadingScreen && loadingScreen) {
        loadingScreen.classList.add('hide');
        setTimeout(() => loadingScreen.style.display = 'none', 300);
      }

      render();
    }
  }

  init();
})();