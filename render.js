// Render module - page rendering functions and UI helpers
import { byId, $$, escapeHtml, normalizeHex, gruvboxColors, secondsToHMS, getTotalSeconds, uuid, now, secondsToHoursMinutesSeconds, hoursMinutesSecondsToTotal } from './utils.js';
import { saveTimers } from './storage.js';
import { validateTimer } from './validation.js';

export function setTheme(theme){
  const t = theme || window.state?.prefs?.theme || 'system';
  if(t==='system'){
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', t);
  }
}

export function renderList(){
  const listEl = byId('timerList');
  listEl.innerHTML = '';
  const timers = window.state.timers.slice().sort((a,b)=> a.name.localeCompare(b.name));
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
        window.go('edit', t.id);
      } else {
        window.go('run', t.id);
      }
    });
    listEl.appendChild(row);
  }
}

function getOrCreateDraft(id){
  let t = window.state.timers.find(x=>x.id===id);
  if (t) return t;
  const newId = id || uuid();
  if (!window.drafts[newId]) {
    window.drafts[newId] = {
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
  return window.drafts[newId];
}

export function renderEdit(id){
  const timer = getOrCreateDraft(id);
  byId('timerName').value = timer.name || '';
  byId('deleteTimerBtn').style.display = window.state.timers.some(x=>x.id===id)? 'inline-block':'none';

  // Render rows
  const blocksEl = byId('blocks');
  blocksEl.innerHTML='';
  timer.blocks.forEach((b, idx)=> blocksEl.appendChild(blockRow(b, idx, id)) );

  // Bind buttons
  byId('addBlockBtn').onclick = ()=>{
    updateFromRows(timer);
    timer.blocks.push({
      atSeconds: getTotalSeconds(timer.blocks)+60,
      colorHex:'#5b8cff',
      label: byId('defaultLabel').value||''
    });
    renderEdit(timer.id);
  };

  byId('sortBlocksBtn').onclick = ()=>{
    updateFromRows(timer);
    timer.blocks.sort((a,b)=>a.atSeconds-b.atSeconds);
    renderEdit(timer.id);
  };

  byId('validateBtn').onclick = ()=>{
    updateFromRows(timer);
    const v = validateTimer(timer);
    const msg = byId('validateMsg');
    msg.textContent = v.ok? 'Looks good ✅' : v.errors.join(' ');
    msg.className = 'small ' + (v.ok? 'ok':'error');
  };

  byId('saveTimerBtn').onclick = ()=>{
    updateFromRows(timer);
    const v = validateTimer(timer);
    if(!v.ok){
      alert('Fix errors before saving:\n'+v.errors.join('\n'));
      return;
    }
    saveTimer(timer);
    window.go('list');
  };

  byId('deleteTimerBtn').onclick = ()=>{
    if (confirm('Delete this timer?')){
      window.state.timers = window.state.timers.filter(x=>x.id!==id);
      saveTimers(window.state.timers);
      try{ delete window.drafts[timer.id]; }catch{}
      window.go('list');
    }
  };

  byId('backFromEdit').onclick = ()=> window.go('list');

  function blockRow(block, idx, tid){
    const row = document.createElement('div');
    row.className = 'block-row';
    row.dataset.index = idx;
    const timeData = secondsToHoursMinutesSeconds(block.atSeconds);
    const isFirstBlock = idx === 0;

    row.innerHTML = `
      <div>
        <div class="block-row-label">Time</div>
        <div class="time-input" role="group" aria-label="Timer duration">
          <input
            aria-label="Hours"
            aria-describedby="hours-help-${idx}"
            type="number"
            min="0"
            step="1"
            value="${timeData.hours}"
            class="hours-input"
            title="${isFirstBlock ? 'Start time (always 0:0:0)' : 'Hours (0 or more)'}"
            ${isFirstBlock ? 'disabled' : ''} />
          <span class="time-label" id="hours-help-${idx}">H</span>
          <span class="separator">:</span>
          <input
            aria-label="Minutes"
            aria-describedby="minutes-help-${idx}"
            type="number"
            min="0"
            max="59"
            step="1"
            value="${timeData.minutes}"
            class="minutes-input"
            title="${isFirstBlock ? 'Start time (always 0:0:0)' : 'Minutes (0-59)'}"
            ${isFirstBlock ? 'disabled' : ''} />
          <span class="time-label" id="minutes-help-${idx}">M</span>
          <span class="separator">:</span>
          <input
            aria-label="Seconds"
            aria-describedby="seconds-help-${idx}"
            type="number"
            min="0"
            max="59"
            step="1"
            value="${timeData.seconds}"
            class="seconds-input"
            title="${isFirstBlock ? 'Start time (always 0:0:0)' : 'Seconds (0-59)'}"
            ${isFirstBlock ? 'disabled' : ''} />
          <span class="time-label" id="seconds-help-${idx}">S</span>
        </div>
      </div>
      <div>
        <div class="block-row-label">Color</div>
        <div class="color-selector">
          <div class="color-preview" style="background-color:${normalizeHex(block.colorHex)}" data-color="${normalizeHex(block.colorHex)}"></div>
          <div class="color-popover">
            <div class="color-grid">${gruvboxColors.map(color => `<div class="color-option" style="background-color:${color}" data-color="${color}" title="${color}"></div>`).join('')}</div>
            <div class="custom-color-row">
              <span class="small">Custom:</span>
              <input type="color" class="custom-color-input" value="${normalizeHex(block.colorHex)}">
            </div>
          </div>
        </div>
      </div>
      <div>
        <div class="block-row-label">Label</div>
        <input aria-label="Label (optional)" type="text" placeholder="Label (optional)" value="${escapeHtml(block.label||'')}" />
      </div>
      <div>
        <div class="block-row-label">&nbsp;</div>
        <button class="btn" title="Remove block" ${isFirstBlock ? 'style="display:none"' : ''}>✕</button>
      </div>`;

    // Set up color selector
    const colorPreview = row.querySelector('.color-preview');
    const colorPopover = row.querySelector('.color-popover');
    const colorOptions = row.querySelectorAll('.color-option');
    const customColorInput = row.querySelector('.custom-color-input');

    // Toggle popover
    colorPreview.addEventListener('click', (e) => {
      e.stopPropagation();
      colorPopover.classList.toggle('show');
    });

    // Close popover when clicking outside
    document.addEventListener('click', () => colorPopover.classList.remove('show'));
    colorPopover.addEventListener('click', (e) => e.stopPropagation());

    // Handle color selection
    colorOptions.forEach(option => {
      option.addEventListener('click', () => {
        const color = option.dataset.color;
        colorPreview.style.backgroundColor = color;
        colorPreview.dataset.color = color;
        customColorInput.value = color;
        colorPopover.classList.remove('show');
      });
    });

    // Handle custom color input
    customColorInput.addEventListener('change', () => {
      const color = customColorInput.value;
      colorPreview.style.backgroundColor = color;
      colorPreview.dataset.color = color;
    });

    row.children[3].querySelector('button').addEventListener('click', ()=>{
      const t = window.state.timers.find(x=>x.id===tid) || timer;
      const index = +row.dataset.index;
      t.blocks.splice(index,1);
      if(t.blocks.length===0)
        t.blocks.push({atSeconds:0,colorHex:'#FFD400',label:'Start'});
      renderEdit(t.id);
    });
    return row;
  }

  function updateFromRows(timer){
    const rows = $$('#blocks .block-row');
    timer.blocks = rows.map((r, idx)=>{
      const hoursInput = r.querySelector('.hours-input');
      const minutesInput = r.querySelector('.minutes-input');
      const secondsInput = r.querySelector('.seconds-input');
      const hours = parseInt(hoursInput.value || '0', 10);
      const minutes = parseInt(minutesInput.value || '0', 10);
      const seconds = parseInt(secondsInput.value || '0', 10);

      return {
        atSeconds: idx === 0 ? 0 : hoursMinutesSecondsToTotal(hours, minutes, seconds), // First block always 0
        colorHex: normalizeHex(r.children[1].querySelector('.color-preview').dataset.color||'#000000'),
        label: r.children[2].querySelector('input').value||''
      };
    });
    timer.updatedAt = now();
  }
}

export function saveTimer(timer){
  const existing = window.state.timers.findIndex(x=>x.id===timer.id);
  if (existing >= 0)
    window.state.timers[existing] = timer;
  else
    window.state.timers.push(timer);
  saveTimers(window.state.timers);
  renderList();
}

// Make renderList available globally for Firebase sync
window.renderList = renderList;