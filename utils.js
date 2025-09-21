// Utilities module
export const $ = sel => document.querySelector(sel);
export const $$ = sel => [...document.querySelectorAll(sel)];
export const byId = id => document.getElementById(id);
export const fmt = s => String(s).padStart(2, '0');
export const uuid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
export const now = () => Date.now();
export const deepClone = obj => JSON.parse(JSON.stringify(obj));

// Gruvbox Material Color Palette
export const gruvboxColors = [
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
export const speak = txt => {
  try {
    if (!window.state?.prefs?.speak) return;
    const u = new SpeechSynthesisUtterance(txt);
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  } catch(e){}
};

export const vibrate = pat => {
  try {
    if (!window.state?.prefs?.vibrate) return;
    navigator.vibrate?.(pat || 100);
  } catch(e){}
};

export const live = txt => {
  const n = byId('liveRegion');
  if (n) n.textContent = txt;
};

// Time conversion helpers
export function secondsToHMS(sec){
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec/3600), m = Math.floor((sec%3600)/60), s = sec%60;
  return (h? fmt(h)+':':'') + fmt(m) + ':' + fmt(s);
}

export function secondsToHoursMinutesSeconds(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return { hours, minutes, seconds };
}

export function hoursMinutesSecondsToTotal(hours, minutes, seconds) {
  return Math.max(0,
    (parseInt(hours || 0, 10) * 3600) +
    (parseInt(minutes || 0, 10) * 60) +
    parseInt(seconds || 0, 10)
  );
}

export function getTotalSeconds(blocks){
  return blocks.length? blocks[blocks.length-1].atSeconds : 0;
}

// HTML helpers
export function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[c]));
}

export function normalizeHex(h){
  h = (h||'').trim();
  if(!h) return '#000000';
  if(h[0] !== '#') h = '#'+h;
  return h.slice(0,7);
}