(function () {
  // -------- Utilities --------
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => [...document.querySelectorAll(sel)];
  const byId = (id) => document.getElementById(id);
  const fmt = (s) => String(s).padStart(2, "0");
  const uuid = () =>
    Math.random().toString(36).slice(2) + Date.now().toString(36);
  const speak = (txt) => {
    try {
      if (!state.prefs.speak) return;
      const u = new SpeechSynthesisUtterance(txt);
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    } catch (e) {}
  };
  const vibrate = (pat) => {
    try {
      if (!state.prefs.vibrate) return;
      navigator.vibrate?.(pat || 100);
    } catch (e) {}
  };
  const live = (txt) => {
    const n = byId("liveRegion");
    n.textContent = txt;
  };
  const now = () => Date.now();
  const deepClone = (obj) => JSON.parse(JSON.stringify(obj));

  // Gruvbox Material Color Palette
  const gruvboxColors = [
    // Neutral tones
    "#282828",
    "#3c3836",
    "#504945",
    "#665c54", // darks
    "#928374",
    "#a89984",
    "#bdae93",
    "#d5c4a1", // grays
    "#ebdbb2",
    "#fbf1c7",
    "#f9f5d7",
    "#f2e5bc", // lights
    // Accent colors
    "#cc241d",
    "#fb4934", // reds
    "#d65d0e",
    "#fe8019", // oranges
    "#d79921",
    "#fabd2f", // yellows
    "#98971a",
    "#b8bb26", // greens
    "#689d6a",
    "#8ec07c", // aquas
    "#458588",
    "#83a598", // blues
    "#b16286",
    "#d3869b", // purples
  ];

  function secondsToHMS(sec) {
    sec = Math.max(0, Math.floor(sec));
    const h = Math.floor(sec / 3600),
      m = Math.floor((sec % 3600) / 60),
      s = sec % 60;
    return (h ? fmt(h) + ":" : "") + fmt(m) + ":" + fmt(s);
  }

  // Time conversion helpers
  function secondsToHoursMinutesSeconds(totalSeconds) {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return { hours, minutes, seconds };
  }

  function hoursMinutesSecondsToTotal(hours, minutes, seconds) {
    return Math.max(
      0,
      parseInt(hours || 0, 10) * 3600 +
        parseInt(minutes || 0, 10) * 60 +
        parseInt(seconds || 0, 10),
    );
  }

  function getTotalSeconds(blocks) {
    return blocks.length ? blocks[blocks.length - 1].atSeconds : 0;
  }

  // -------- Storage (local) --------
  const LS_TIMERS = "cbtimers.v1";
  const LS_PREFS = "cbprefs.v1";
  function loadTimers() {
    try {
      return JSON.parse(localStorage.getItem(LS_TIMERS) || "[]");
    } catch {
      return [];
    }
  }
  function saveTimers(list) {
    localStorage.setItem(LS_TIMERS, JSON.stringify(list));
    // Auto-sync to Firestore if user is signed in
    if (state.user) {
      syncToFirestore();
    }
  }
  function loadPrefs() {
    const d = {
      speak: false,
      vibrate: false,
      wake: true,
      theme: "system",
      onboarded: true,
    };
    try {
      return Object.assign(
        d,
        JSON.parse(localStorage.getItem(LS_PREFS) || "{}"),
      );
    } catch {
      return d;
    }
  }
  function savePrefs(p) {
    localStorage.setItem(LS_PREFS, JSON.stringify(p));
    // Auto-sync to Firestore if user is signed in
    if (state.user) {
      syncToFirestore();
    }
  }

  // -------- Firebase Auth & Sync --------
  let firebase = null;
  let isInitialized = false;

  async function initFirebase() {
    if (isInitialized) return firebase;

    // Wait for Firebase to be available from the module script
    let attempts = 0;
    while (!window.firebaseApp && attempts < 50) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      attempts++;
    }

    if (!window.firebaseApp) {
      console.warn("Firebase not available");
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
          // User signed in - sync data
          syncFromFirestore();
        }
        // Resolve on first auth state change (initial check)
        if (!hasInitiallyResolved) {
          hasInitiallyResolved = true;
          resolve(firebase);
        }
      });
    });
  }

  async function signInWithGoogle() {
    const fb = await initFirebase();
    if (!fb) return;

    try {
      const provider = new fb.GoogleAuthProvider();
      const result = await fb.signInWithPopup(fb.auth, provider);
      const user = result.user;
      live(`Signed in as ${user.displayName}`);
      return user;
    } catch (error) {
      console.error("Sign-in error:", error);
      alert("Sign-in failed: " + error.message);
    }
  }

  async function signOutUser() {
    const fb = await initFirebase();
    if (!fb) return;

    try {
      await fb.signOut(fb.auth);
      live("Signed out");
    } catch (error) {
      console.error("Sign-out error:", error);
    }
  }

  async function syncToFirestore() {
    const fb = await initFirebase();
    if (!fb || !state.user) return;

    try {
      const userRef = fb.doc(fb.db, "users", state.user.uid);
      await fb.setDoc(userRef, {
        timers: state.timers,
        prefs: state.prefs,
        updatedAt: fb.serverTimestamp(),
      });
      console.log("Data synced to Firestore");
    } catch (error) {
      console.error("Sync to Firestore failed:", error);
    }
  }

  async function syncFromFirestore() {
    const fb = await initFirebase();
    if (!fb || !state.user) return;

    try {
      const userRef = fb.doc(fb.db, "users", state.user.uid);
      const doc = await fb.getDoc(userRef);

      if (doc.exists()) {
        const data = doc.data();

        // Merge remote data with local data (local takes precedence for conflicts)
        if (data.timers && Array.isArray(data.timers)) {
          const remoteTimers = data.timers;
          const localTimerIds = new Set(state.timers.map((t) => t.id));

          // Add remote timers that don't exist locally
          for (const remoteTimer of remoteTimers) {
            if (!localTimerIds.has(remoteTimer.id)) {
              state.timers.push(remoteTimer);
            }
          }

          saveTimers(state.timers);
          // Only render list if we're not in onboarding
          if (state.prefs.onboarded) {
            renderList();
          }
        }

        if (data.prefs) {
          // Merge preferences (local takes precedence)
          state.prefs = Object.assign({}, data.prefs, state.prefs);
          savePrefs(state.prefs);
        }

        console.log("Data synced from Firestore");
      }
    } catch (error) {
      console.error("Sync from Firestore failed:", error);
    }
  }

  function updateAuthUI() {
    // Header auth button - show after auth check completes
    const authBtn = byId("authBtn");
    if (authBtn) {
      if (state.user) {
        authBtn.style.display = "none";
      } else {
        authBtn.style.display = "inline-block";
        authBtn.textContent = "Sign In";
        authBtn.title = "Sign in with Google to sync across devices";
        authBtn.onclick = signInWithGoogle;
      }
    }

    // Settings page auth controls
    const authStatus = byId("authStatus");
    const authActionBtn = byId("authActionBtn");
    const syncNowBtn = byId("syncNowBtn");

    if (authStatus && authActionBtn) {
      if (state.user) {
        authStatus.textContent = `Signed in as ${state.user.displayName || state.user.email}. Your timers sync automatically.`;
        authActionBtn.textContent = "Sign Out";
        authActionBtn.onclick = signOutUser;
        if (syncNowBtn) {
          syncNowBtn.style.display = "inline-block";
          syncNowBtn.onclick = () => {
            syncToFirestore();
            syncFromFirestore();
            syncNowBtn.textContent = "Synced!";
            setTimeout(() => (syncNowBtn.textContent = "Sync Now"), 2000);
          };
        }
      } else {
        authStatus.textContent = "Sign in to sync your timers across devices";
        authActionBtn.textContent = "Sign In with Google";
        authActionBtn.onclick = signInWithGoogle;
        if (syncNowBtn) {
          syncNowBtn.style.display = "none";
        }
      }
    }
  }

  // -------- App State --------
  const state = {
    timers: loadTimers(),
    prefs: loadPrefs(),
    route: { page: "list", id: null },
    user: null,
  };

  // Draft timers cache (for unsaved edits)
  const drafts = {};

  // Empty state handled by renderList() function

  // -------- Validation --------
  function validateTimer(timer) {
    const errors = [];
    const blocks = deepClone(timer.blocks).sort(
      (a, b) => a.atSeconds - b.atSeconds,
    );
    if (blocks.length === 0) errors.push("Add at least one block.");

    // Ensure first block always starts at 0
    if (blocks.length > 0) {
      blocks[0].atSeconds = 0;
    }

    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      if (i > 0 && b.atSeconds < 0)
        errors.push(`Block ${i + 1}: time cannot be negative.`);
      if (!/^#?[0-9A-Fa-f]{6}$/.test(b.colorHex))
        errors.push(`Block ${i + 1}: invalid color.`);
      if (i > 0 && b.atSeconds === blocks[i - 1].atSeconds)
        errors.push(`Duplicate time at ${b.atSeconds}s.`);
      if (i > 0 && b.atSeconds < blocks[i - 1].atSeconds)
        errors.push("Blocks must be in ascending time order.");
    }
    return { ok: errors.length === 0, errors };
  }

  // -------- Router --------
  function go(page, id) {
    location.hash = "#/" + page + (id ? "/" + id : "");
  }
  function parseHash() {
    const h = location.hash.slice(2).split("/");
    const page = h[0] || "list";
    const id = h[1] || null;
    return { page, id };
  }
  // Only add hashchange listener if user is onboarded
  function addHashListener() {
    window.addEventListener("hashchange", render);
  }

  // Add listener conditionally and set body class
  if (state.prefs.onboarded) {
    addHashListener();
    document.body.classList.add("onboarded");
  }

  // -------- Render --------
  function setTheme(theme) {
    const t = theme || state.prefs.theme || "system";
    if (t === "system") {
      document.documentElement.removeAttribute("data-theme");
    } else {
      document.documentElement.setAttribute("data-theme", t);
    }
  }

  function renderList() {
    // Don't render list at all if user is not onboarded
    if (!state.prefs.onboarded) {
      return;
    }

    const listEl = byId("timerList");
    listEl.innerHTML = "";
    const timers = state.timers
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name));
    if (timers.length === 0) {
      // Only show empty state if user is onboarded (not in onboarding flow)
      if (state.prefs.onboarded) {
        byId("emptyState").style.display = "block";
      }
      return;
    }
    byId("emptyState").style.display = "none";
    for (const t of timers) {
      const total = getTotalSeconds(t.blocks);
      const row = document.createElement("button");
      row.className = "card row";
      row.setAttribute("role", "listitem");
      row.style.textAlign = "left";
      row.innerHTML = `
        <div class="stack" style="flex:1">
          <div class="section-title" style="margin:0">${escapeHtml(t.name)}</div>
          <div class="small muted">${t.blocks.length} block${t.blocks.length > 1 ? "s" : ""} • ${secondsToHMS(total)}</div>
        </div>
        <div class="row">
          <button class="btn" data-edit="${t.id}">Edit</button>
          <span class="pill">Run ▶</span>
        </div>`;
      row.addEventListener("click", (e) => {
        if (e.target?.dataset?.edit) {
          go("edit", t.id);
        } else {
          go("run", t.id);
        }
      });
      listEl.appendChild(row);
    }
  }
  function getOrCreateDraft(id) {
    let t = state.timers.find((x) => x.id === id);
    if (t) return t;
    const newId = id || uuid();
    if (!drafts[newId]) {
      drafts[newId] = {
        id: newId,
        name: "",
        blocks: [
          {
            atSeconds: 0,
            colorHex: "#FFD400",
            label: byId("defaultLabel").value || "Start",
          },
        ],
        createdAt: now(),
        updatedAt: now(),
      };
    }
    return drafts[newId];
  }

  function renderEdit(id) {
    const timer = getOrCreateDraft(id);
    byId("timerName").value = timer.name || "";
    byId("deleteTimerBtn").style.display = state.timers.some((x) => x.id === id)
      ? "inline-block"
      : "none";

    // Save timer name when input loses focus
    byId("timerName").onblur = () => {
      timer.name = byId("timerName").value;
      timer.updatedAt = now();
    };
    // Render rows
    const blocksEl = byId("blocks");
    blocksEl.innerHTML = "";
    timer.blocks.forEach((b, idx) =>
      blocksEl.appendChild(blockRow(b, idx, id)),
    );
    // Bind buttons
    byId("addBlockBtn").onclick = () => {
      updateFromRows(timer);
      timer.blocks.push({
        atSeconds: getTotalSeconds(timer.blocks) + 60,
        colorHex: "#5b8cff",
        label: byId("defaultLabel").value || "",
      });
      renderEdit(timer.id);
    };
    byId("sortBlocksBtn").onclick = () => {
      updateFromRows(timer);
      timer.blocks.sort((a, b) => a.atSeconds - b.atSeconds);
      renderEdit(timer.id);
    };
    byId("validateBtn").onclick = () => {
      updateFromRows(timer);
      const v = validateTimer(timer);
      const msg = byId("validateMsg");
      msg.textContent = v.ok ? "Looks good ✅" : v.errors.join(" ");
      msg.className = "small " + (v.ok ? "ok" : "error");
    };
    byId("saveTimerBtn").onclick = () => {
      updateFromRows(timer);
      timer.name = byId("timerName").value;
      const v = validateTimer(timer);
      if (!v.ok) {
        alert("Fix errors before saving:\n" + v.errors.join("\n"));
        return;
      }
      saveTimer(timer);
      go("list");
    };
    byId("deleteTimerBtn").onclick = () => {
      if (confirm("Delete this timer?")) {
        state.timers = state.timers.filter((x) => x.id !== id);
        saveTimers(state.timers);
        try {
          delete drafts[timer.id];
        } catch {}
        go("list");
      }
    };
    byId("backFromEdit").onclick = () => go("list");

    function blockRow(block, idx, tid) {
      const row = document.createElement("div");
      row.className = "block-row";
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
              title="${isFirstBlock ? "Start time (always 0:0:0)" : "Hours (0 or more)"}"
              ${isFirstBlock ? "disabled" : ""} />
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
              title="${isFirstBlock ? "Start time (always 0:0:0)" : "Minutes (0-59)"}"
              ${isFirstBlock ? "disabled" : ""} />
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
              title="${isFirstBlock ? "Start time (always 0:0:0)" : "Seconds (0-59)"}"
              ${isFirstBlock ? "disabled" : ""} />
            <span class="time-label" id="seconds-help-${idx}">S</span>
          </div>
        </div>
        <div>
          <div class="block-row-label">Color</div>
          <div class="color-selector">
            <div class="color-preview" style="background-color:${normalizeHex(block.colorHex)}" data-color="${normalizeHex(block.colorHex)}"></div>
            <div class="color-popover">
              <div class="color-grid">${gruvboxColors.map((color) => `<div class="color-option" style="background-color:${color}" data-color="${color}" title="${color}"></div>`).join("")}</div>
              <div class="custom-color-row">
                <span class="small">Custom:</span>
                <input type="color" class="custom-color-input" value="${normalizeHex(block.colorHex)}">
              </div>
            </div>
          </div>
        </div>
        <div>
          <div class="block-row-label">Label</div>
          <input aria-label="Label (optional)" type="text" placeholder="Label (optional)" value="${escapeHtml(block.label || "")}" />
        </div>
        <div>
          <div class="block-row-label">&nbsp;</div>
          <button class="btn" title="Remove block" ${isFirstBlock ? 'style="display:none"' : ""}>✕</button>
        </div>`;

      // Set up color selector
      const colorPreview = row.querySelector(".color-preview");
      const colorPopover = row.querySelector(".color-popover");
      const colorOptions = row.querySelectorAll(".color-option");
      const customColorInput = row.querySelector(".custom-color-input");

      // Toggle popover
      colorPreview.addEventListener("click", (e) => {
        e.stopPropagation();
        colorPopover.classList.toggle("show");
      });

      // Close popover when clicking outside
      document.addEventListener("click", () =>
        colorPopover.classList.remove("show"),
      );
      colorPopover.addEventListener("click", (e) => e.stopPropagation());

      // Handle color selection
      colorOptions.forEach((option) => {
        option.addEventListener("click", () => {
          const color = option.dataset.color;
          colorPreview.style.backgroundColor = color;
          colorPreview.dataset.color = color;
          customColorInput.value = color;
          colorPopover.classList.remove("show");
        });
      });

      // Handle custom color input
      customColorInput.addEventListener("change", () => {
        const color = customColorInput.value;
        colorPreview.style.backgroundColor = color;
        colorPreview.dataset.color = color;
      });

      row.children[3].querySelector("button").addEventListener("click", () => {
        const t = state.timers.find((x) => x.id === tid) || timer;
        const index = +row.dataset.index;
        t.blocks.splice(index, 1);
        if (t.blocks.length === 0)
          t.blocks.push({ atSeconds: 0, colorHex: "#FFD400", label: "Start" });
        renderEdit(t.id);
      });
      return row;
    }

    function updateFromRows(timer) {
      const rows = $$("#blocks .block-row");
      timer.blocks = rows.map((r, idx) => {
        const hoursInput = r.querySelector(".hours-input");
        const minutesInput = r.querySelector(".minutes-input");
        const secondsInput = r.querySelector(".seconds-input");
        const hours = parseInt(hoursInput.value || "0", 10);
        const minutes = parseInt(minutesInput.value || "0", 10);
        const seconds = parseInt(secondsInput.value || "0", 10);

        return {
          atSeconds:
            idx === 0 ? 0 : hoursMinutesSecondsToTotal(hours, minutes, seconds), // First block always 0
          colorHex: normalizeHex(
            r.children[1].querySelector(".color-preview").dataset.color ||
              "#000000",
          ),
          label: r.children[2].querySelector("input").value || "",
        };
      });
      timer.updatedAt = now();
    }
  }

  function saveTimer(timer) {
    const existing = state.timers.findIndex((x) => x.id === timer.id);
    if (existing >= 0) state.timers[existing] = timer;
    else state.timers.push(timer);
    saveTimers(state.timers);
    renderList();
  }

  // Escape HTML helper
  function escapeHtml(s) {
    return String(s).replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#039;",
        })[c],
    );
  }
  function normalizeHex(h) {
    h = (h || "").trim();
    if (!h) return "#000000";
    if (h[0] !== "#") h = "#" + h;
    return h.slice(0, 7);
  }

  // -------- Run engine --------
  const Engine = (() => {
    let timer = null,
      tick = null,
      startMs = 0,
      pausedAt = 0,
      currentIdx = 0,
      activeId = null,
      wakeLock = null;

    async function requestWake() {
      if (!state.prefs.wake) return;
      try {
        wakeLock = await navigator.wakeLock?.request("screen");
        wakeLock?.addEventListener("release", () =>
          console.log("WakeLock released"),
        );
      } catch (e) {
        console.warn("WakeLock failed", e);
      }
    }
    async function releaseWake() {
      try {
        await wakeLock?.release?.();
      } catch {
      } finally {
        wakeLock = null;
      }
    }

    function scheduleNext(t) {
      clearTimers();
      const blocks = t.blocks.slice().sort((a, b) => a.atSeconds - b.atSeconds);
      const total = getTotalSeconds(blocks);
      const elapsed = getElapsed();
      // Find current index by elapsed
      currentIdx = 0;
      while (
        currentIdx < blocks.length - 1 &&
        elapsed >= blocks[currentIdx + 1].atSeconds
      ) {
        currentIdx++;
      }
      applyBlock(blocks[currentIdx], t);
      // Schedule the next change
      if (currentIdx < blocks.length - 1) {
        const nextAt = blocks[currentIdx + 1].atSeconds * 1000 - getElapsedMs();
        timer = setTimeout(
          () => {
            currentIdx++;
            applyBlock(blocks[currentIdx], t);
            scheduleNext(t);
          },
          Math.max(0, nextAt),
        );
      } else {
        // End watcher to fire done when crossing total
        timer = setTimeout(
          () => {
            done(t);
          },
          Math.max(0, total * 1000 - getElapsedMs()),
        );
      }
      // UI ticker
      tick = setInterval(() => updateRunUI(t), 250);
    }

    function applyBlock(b, t) {
      const root = byId("runRoot");
      root.style.background = normalizeHex(b.colorHex);
      const title = byId("runTitle");
      title.textContent = `${t.name || "Timer"}`.trim();
      const say = b.label || `Change`;
      speak(say);
      vibrate([120, 60, 120]);
      live(`Block: ${say}`);
      updateRunUI(t);
    }

    function updateRunUI(t) {
      const blocks = t.blocks.slice().sort((a, b) => a.atSeconds - b.atSeconds);
      const elapsed = getElapsed();
      const total = getTotalSeconds(blocks);
      // find next change
      let next = total;
      for (let i = 0; i < blocks.length; i++) {
        if (blocks[i].atSeconds > elapsed) {
          next = blocks[i].atSeconds;
          break;
        }
      }
      const remainingToNext = Math.max(0, Math.floor(next - elapsed));
      byId("runInfo").textContent =
        `Elapsed ${secondsToHMS(elapsed)} • Next change in ${secondsToHMS(remainingToNext)} • Total ${secondsToHMS(total)}`;
      updateToggleButton();
    }

    function updateToggleButton() {
      const toggleBtn = byId("toggleBtn");
      if (!toggleBtn) return;
      if (isRunning()) {
        toggleBtn.textContent = "Pause";
      } else {
        toggleBtn.textContent = "Start";
      }
    }

    function start(t) {
      activeId = t.id;
      startMs = now();
      pausedAt = 0;
      scheduleNext(t);
      requestWake();
      updateToggleButton();
    }
    function pause() {
      if (pausedAt) return;
      pausedAt = now();
      clearTimers();
      releaseWake();
      live("Paused");
      updateToggleButton();
    }
    function resume(t) {
      if (!pausedAt) return;
      const pausedDur = now() - pausedAt;
      startMs += pausedDur;
      pausedAt = 0;
      scheduleNext(t);
      requestWake();
      updateToggleButton();
    }
    function reset(t) {
      clearTimers();
      startMs = now();
      pausedAt = 0;
      currentIdx = 0;
      applyBlock(t.blocks[0], t);
      updateRunUI(t);
      releaseWake();
      updateToggleButton();
    }
    function done(t) {
      clearTimers();
      speak("Done");
      vibrate([200, 100, 200, 100, 200]);
      live("Timer finished");
      releaseWake();
      updateToggleButton();
    }

    function getElapsedMs() {
      return Math.max(0, (pausedAt || now()) - startMs);
    }
    function getElapsed() {
      return Math.floor(getElapsedMs() / 1000);
    }
    function clearTimers() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (tick) {
        clearInterval(tick);
        tick = null;
      }
    }

    // visibility handling to re-acquire wake lock
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && activeId && !pausedAt) {
        requestWake();
      }
    });

    function stop() {
      clearTimers();
      releaseWake();
      activeId = null;
      pausedAt = 0;
      startMs = 0;
      currentIdx = 0;
      updateToggleButton();
    }

    function isRunning() {
      return !!activeId && !pausedAt;
    }
    function isPaused() {
      return !!activeId && !!pausedAt;
    }
    function toggle(t) {
      if (!activeId) {
        start(t);
      } else if (pausedAt) {
        resume(t);
      } else {
        pause();
      }
    }

    return { start, pause, resume, reset, stop, toggle, updateToggleButton };
  })();

  // -------- Event wiring --------
  byId("addTimerBtn").onclick = () => go("edit");
  byId("createSampleBtn").onclick = () => {
    const t = {
      id: uuid(),
      name: "Pomodoro 25/5",
      blocks: [
        { atSeconds: 0, colorHex: "#2ecc71", label: "Focus" },
        { atSeconds: 25 * 60, colorHex: "#ffb400", label: "Break" },
        { atSeconds: 30 * 60, colorHex: "#2ecc71", label: "Focus" },
        { atSeconds: 55 * 60, colorHex: "#ffb400", label: "Break" },
        { atSeconds: 60 * 60, colorHex: "#e7002f", label: "Done" },
      ],
      createdAt: now(),
      updatedAt: now(),
    };
    saveTimer(t);
    go("list");
  };

  // In-memory settings functions
  function showSettings() {
    show("settings");
    loadPrefControls();
  }
  function hideSettings() {
    show("list");
  }

  byId("settingsBtn").onclick = showSettings;
  byId("backFromSettings").onclick = hideSettings;

  // Preferences
  function loadPrefControls() {
    byId("prefSpeak").checked = !!state.prefs.speak;
    byId("prefVibrate").checked = !!state.prefs.vibrate;
    byId("prefWake").checked = !!state.prefs.wake;
    byId("prefTheme").value = state.prefs.theme || "system";
  }
  function savePrefControls() {
    state.prefs.speak = byId("prefSpeak").checked;
    state.prefs.vibrate = byId("prefVibrate").checked;
    state.prefs.wake = byId("prefWake").checked;
    state.prefs.theme = byId("prefTheme").value;
    savePrefs(state.prefs);
    setTheme();
  }
  $$("#prefSpeak, #prefVibrate, #prefWake, #prefTheme").forEach((el) =>
    el.addEventListener("change", savePrefControls),
  );

  // Run page controls
  byId("backFromRun").onclick = () => {
    Engine.stop();
    go("list");
  };
  byId("toggleBtn").onclick = () => {
    const t = state.timers.find((x) => x.id === state.route.id);
    if (!t) return;
    Engine.toggle(t);
  };
  byId("resetBtn").onclick = () => {
    const t = state.timers.find((x) => x.id === state.route.id);
    if (!t) return;
    Engine.reset(t);
  };
  byId("fullscreenBtn").onclick = () => {
    const el = byId("runRoot");
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      el.requestFullscreen?.();
    }
  };

  // Toggle start/pause by clicking anywhere on the run view (except controls)
  byId("runRoot").addEventListener("click", (e) => {
    if (e.target.closest(".run-panel") || e.target.closest("button")) return; // ignore clicks on controls
    const t = state.timers.find((x) => x.id === state.route.id);
    if (!t) return;
    Engine.toggle(t);
  });

  // PWA install prompt (optional best-effort)
  let deferredPrompt = null;
  let isAppInstalled = false;

  // Check if app is already installed
  window.addEventListener('appinstalled', () => {
    console.log('App was installed');
    isAppInstalled = true;
    updateInstallUI();
  });

  // Check if running as PWA
  function isPWA() {
    return window.matchMedia('(display-mode: standalone)').matches ||
           window.navigator.standalone === true;
  }

  function updateInstallUI() {
    const headerInstallBtn = byId("installBtn");
    const settingsInstallBtn = byId("settingsInstallBtn");
    const installStatus = byId("installStatus");

    if (isPWA() || isAppInstalled) {
      // App is already installed
      if (headerInstallBtn) headerInstallBtn.hidden = true;
      if (settingsInstallBtn) settingsInstallBtn.style.display = "none";
      if (installStatus) installStatus.textContent = "✅ Time Box is installed as an app!";
    } else if (deferredPrompt) {
      // Can install
      if (headerInstallBtn) headerInstallBtn.hidden = false;
      if (settingsInstallBtn) settingsInstallBtn.style.display = "inline-block";
      if (installStatus) installStatus.textContent = "Install Time Box as an app for quick access and offline use.";
    } else {
      // Cannot install (unsupported browser or other reasons)
      if (headerInstallBtn) headerInstallBtn.hidden = true;
      if (settingsInstallBtn) settingsInstallBtn.style.display = "none";
      if (installStatus) installStatus.textContent = "App installation not available in this browser.";
    }
  }

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    updateInstallUI();
  });

  async function installApp() {
    if (!deferredPrompt) return;

    try {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;

      if (outcome === 'accepted') {
        console.log('User accepted the install prompt');
        isAppInstalled = true;
      } else {
        console.log('User dismissed the install prompt');
      }

      deferredPrompt = null;
      updateInstallUI();
    } catch (e) {
      console.log('Install error:', e);
    }
  }

  // Bind both install buttons
  byId("installBtn").onclick = installApp;
  byId("settingsInstallBtn").onclick = installApp;

  // Update UI on page load
  setTimeout(updateInstallUI, 100);

  // -------- Onboarding --------
  let currentOnboardingStep = 1;

  function showOnboardingStep(step) {
    // Hide all steps
    for (let i = 1; i <= 3; i++) {
      const stepEl = byId(`onboarding-step-${i}`);
      if (stepEl) stepEl.style.display = "none";
    }
    // Show current step
    const currentStep = byId(`onboarding-step-${step}`);
    if (currentStep) currentStep.style.display = "block";
    currentOnboardingStep = step;
  }

  function initOnboarding() {
    // Step 1: Welcome/Features
    byId("onboarding-continue-1").addEventListener("click", () => {
      showOnboardingStep(2);
    });

    // Step 2: Google sign-in
    byId("onboarding-back-2").addEventListener("click", () =>
      showOnboardingStep(1),
    );
    byId("onboarding-skip-signin").addEventListener("click", () => {
      completeOnboarding();
    });
    byId("onboarding-signin").addEventListener("click", async () => {
      try {
        const firebase = window.firebaseApp;
        const provider = new firebase.GoogleAuthProvider();
        const result = await firebase.signInWithPopup(firebase.auth, provider);
        if (result.user) {
          live("Successfully signed in with Google");
          showOnboardingStep(3);
        }
      } catch (error) {
        console.error("Sign-in error:", error);
        alert("Sign-in failed. You can try again later from Settings.");
        completeOnboarding();
      }
    });

    // Step 3: Completion
    byId("onboarding-finish").addEventListener("click", () => {
      completeOnboarding();
    });

    // Start with step 1
    showOnboardingStep(1);
  }

  function completeOnboarding() {
    state.prefs.onboarded = true;
    savePrefs(state.prefs);
    // Add onboarded class to body for CSS
    document.body.classList.add("onboarded");
    // Sync to Firestore if user is signed in
    if (state.user) {
      syncToFirestore();
    }
    // Now that user is onboarded, add hash listener
    addHashListener();
    go("list");
  }

  // -------- Page rendering configuration --------
  const pageConfig = {
    onboarding: {
      shouldShow: () => !state.prefs.onboarded,
      forceHide: () => state.prefs.onboarded,
    },
    list: {
      shouldShow: () => state.prefs.onboarded,
      forceHide: () => !state.prefs.onboarded,
    },
    edit: {
      shouldShow: () => state.prefs.onboarded,
      forceHide: () => !state.prefs.onboarded,
    },
    run: {
      shouldShow: () => state.prefs.onboarded,
      forceHide: () => !state.prefs.onboarded,
    },
    settings: {
      shouldShow: () => state.prefs.onboarded,
      forceHide: () => !state.prefs.onboarded,
    },
  };

  function applyPageVisibility() {
    Object.keys(pageConfig).forEach((pageId) => {
      const page = byId(`page-${pageId}`);
      if (!page) return;

      const config = pageConfig[pageId];
      if (config.forceHide()) {
        page.style.display = "none";
        page.classList.remove("active");
      } else {
        // Remove inline display style to let CSS classes control visibility
        page.style.display = "";
        // Don't add 'active' class here - let the show() function handle that
      }
    });
  }

  // -------- Page switcher --------
  let isShowingPage = false;
  function show(pageId) {
    // Prevent overlapping calls
    if (isShowingPage) {
      setTimeout(() => show(pageId), 10);
      return;
    }
    isShowingPage = true;

    // If user hasn't completed onboarding, force onboarding page
    if (!state.prefs.onboarded && pageId !== "onboarding") {
      pageId = "onboarding";
    }

    // Always hide all pages first - do this more aggressively
    const allPages = $$(".page");
    allPages.forEach((p) => {
      p.classList.remove("active");
    });

    // Small delay to ensure DOM updates complete
    setTimeout(() => {
      // Show the requested page
      byId("page-" + pageId).classList.add("active");
      isShowingPage = false;
    }, 1);
  }

  function render() {
    // Apply page visibility rules based on configuration
    applyPageVisibility();

    // If user is not onboarded, ONLY show onboarding and exit
    if (!state.prefs.onboarded) {
      // Show only onboarding page
      const onboardingPage = byId("page-onboarding");
      onboardingPage.classList.add("active");
      onboardingPage.style.display = "block";

      // Initialize onboarding
      initOnboarding();

      // Prevent any further render logic
      return;
    }

    // Normal render logic for onboarded users
    state.route = parseHash();
    setTheme(state.prefs.theme);
    updateAuthUI();

    if (state.route.page === "list") {
      show("list");
      renderList();
    } else if (state.route.page === "edit") {
      show("edit");
      renderEdit(state.route.id);
    } else if (state.route.page === "run") {
      const t = state.timers.find((x) => x.id === state.route.id);
      if (!t) {
        alert("Timer not found");
        go("list");
        return;
      }
      show("run");
      byId("runRoot").style.background = normalizeHex(
        t.blocks[0]?.colorHex || "#000",
      );
      byId("runTitle").textContent = t.name;
      byId("runInfo").textContent = "Ready";
      Engine.updateToggleButton();
    } else {
      go("list");
    }
  }

  // Init Firebase first, then render after auth check
  async function init() {
    const loadingScreen = byId("loadingScreen");
    const startTime = now();
    let showLoadingScreen = false;

    // Hide loading screen initially
    if (loadingScreen) {
      loadingScreen.style.display = "none";
    }

    // Show loading screen after 120ms if still loading
    const loadingTimeout = setTimeout(() => {
      if (loadingScreen) {
        loadingScreen.style.display = "flex";
        showLoadingScreen = true;
      }
    }, 120);

    try {
      // Load data and initialize Firebase
      await initFirebase();

      // Clear the loading timeout since we're done
      clearTimeout(loadingTimeout);

      // If loading screen was shown, wait for animation to complete
      if (showLoadingScreen) {
        const elapsed = now() - startTime;
        const minLoadTime = 10; // 0.01 seconds (10ms)
        const animationDuration = 10; // 0.01 seconds for the progress bar
        const totalWaitTime = Math.max(minLoadTime, animationDuration);

        if (elapsed < totalWaitTime) {
          await new Promise((resolve) =>
            setTimeout(resolve, totalWaitTime - elapsed),
          );
        }

        // Hide loading screen
        if (loadingScreen) {
          loadingScreen.classList.add("hide");
          setTimeout(() => (loadingScreen.style.display = "none"), 300);
        }
      }

      render();
    } catch (error) {
      console.error("Initialization failed:", error);
      clearTimeout(loadingTimeout);

      // If loading screen was shown, hide it
      if (showLoadingScreen && loadingScreen) {
        loadingScreen.classList.add("hide");
        setTimeout(() => (loadingScreen.style.display = "none"), 300);
      }

      render(); // Still try to render the app
    }
  }
  init();
})();
