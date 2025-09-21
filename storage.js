// Storage module - handles localStorage with Firebase auto-sync
const LS_TIMERS = 'cbtimers.v1';
const LS_PREFS  = 'cbprefs.v1';

export function loadTimers(){
  try {
    return JSON.parse(localStorage.getItem(LS_TIMERS)||'[]');
  } catch {
    return [];
  }
}

export function saveTimers(list){
  localStorage.setItem(LS_TIMERS, JSON.stringify(list));
  // Auto-sync to Firestore if user is signed in
  if (window.state?.user) {
    window.syncToFirestore?.();
  }
}

export function loadPrefs(){
  const d = { speak:true, vibrate:false, wake:true, theme:'system', onboarded:false };
  try {
    return Object.assign(d, JSON.parse(localStorage.getItem(LS_PREFS)||'{}'));
  } catch {
    return d;
  }
}

export function savePrefs(p){
  localStorage.setItem(LS_PREFS, JSON.stringify(p));
  // Auto-sync to Firestore if user is signed in
  if (window.state?.user) {
    window.syncToFirestore?.();
  }
}