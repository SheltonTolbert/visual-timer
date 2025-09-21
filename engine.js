// Timer Engine module
import { byId, speak, vibrate, live, secondsToHMS, getTotalSeconds, normalizeHex, now } from './utils.js';

export const Engine = (()=>{
  let timer=null, tick=null, startMs=0, pausedAt=0, currentIdx=0, activeId=null, wakeLock=null;

  async function requestWake(){
    if(!window.state.prefs.wake) return;
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
    // Find current index by elapsed
    currentIdx = 0;
    while(currentIdx < blocks.length-1 && elapsed >= blocks[currentIdx+1].atSeconds){
      currentIdx++;
    }
    applyBlock(blocks[currentIdx], t);
    // Schedule the next change
    if(currentIdx < blocks.length-1){
      const nextAt = blocks[currentIdx+1].atSeconds*1000 - getElapsedMs();
      timer = setTimeout(()=>{
        currentIdx++;
        applyBlock(blocks[currentIdx], t);
        scheduleNext(t);
      }, Math.max(0,nextAt));
    } else {
      // End watcher to fire done when crossing total
      timer = setTimeout(()=>{
        done(t);
      }, Math.max(0, total*1000 - getElapsedMs()));
    }
    // UI ticker
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
    // find next change
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

  // visibility handling to re-acquire wake lock
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