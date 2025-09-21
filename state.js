// State management module
import { loadTimers, loadPrefs } from './storage.js';
import { byId } from './utils.js';

// App State
export const state = {
  timers: loadTimers(),
  prefs: loadPrefs(),
  route: { page: 'list', id:null },
  user: null,
};

// Draft timers cache (for unsaved edits)
export const drafts = {};

// Make state available globally for modules that need it
window.state = state;
window.drafts = drafts;

// Empty state logic moved to renderList function to avoid showing during onboarding