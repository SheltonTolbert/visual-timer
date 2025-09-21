// Firebase Auth & Sync module
import { live } from './utils.js';
import { saveTimers, savePrefs } from './storage.js';
import { byId } from './utils.js';

let firebase = null;
let isInitialized = false;

export async function initFirebase(){
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
      window.state.user = user;
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

export async function signInWithGoogle(){
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

export async function signOutUser(){
  const fb = await initFirebase();
  if (!fb) return;

  try {
    await fb.signOut(fb.auth);
    live('Signed out');
  } catch (error) {
    console.error('Sign-out error:', error);
  }
}

export async function syncToFirestore(){
  const fb = await initFirebase();
  if (!fb || !window.state.user) return;

  try {
    const userRef = fb.doc(fb.db, 'users', window.state.user.uid);
    await fb.setDoc(userRef, {
      timers: window.state.timers,
      prefs: window.state.prefs,
      updatedAt: fb.serverTimestamp()
    });
    console.log('Data synced to Firestore');
  } catch (error) {
    console.error('Sync to Firestore failed:', error);
  }
}

export async function syncFromFirestore(){
  const fb = await initFirebase();
  if (!fb || !window.state.user) return;

  try {
    const userRef = fb.doc(fb.db, 'users', window.state.user.uid);
    const doc = await fb.getDoc(userRef);

    if (doc.exists()) {
      const data = doc.data();

      // Merge remote data with local data (local takes precedence for conflicts)
      if (data.timers && Array.isArray(data.timers)) {
        const remoteTimers = data.timers;
        const localTimerIds = new Set(window.state.timers.map(t => t.id));

        // Add remote timers that don't exist locally
        for (const remoteTimer of remoteTimers) {
          if (!localTimerIds.has(remoteTimer.id)) {
            window.state.timers.push(remoteTimer);
          }
        }

        saveTimers(window.state.timers);
        // Call render function if available
        window.renderList?.();
      }

      if (data.prefs) {
        // Merge preferences (local takes precedence)
        window.state.prefs = Object.assign({}, data.prefs, window.state.prefs);
        savePrefs(window.state.prefs);
      }

      console.log('Data synced from Firestore');
    }
  } catch (error) {
    console.error('Sync from Firestore failed:', error);
  }
}

export function updateAuthUI(){
  // Header auth button - show after auth check completes
  const authBtn = byId('authBtn');
  if (authBtn) {
    if (window.state.user) {
      authBtn.style.display = 'none';
    } else {
      authBtn.style.display = 'inline-block';
      authBtn.textContent = 'Sign In';
      authBtn.title = 'Sign in with Google to sync across devices';
      authBtn.onclick = signInWithGoogle;
    }
  }

  // Settings page auth controls
  const authStatus = byId('authStatus');
  const authActionBtn = byId('authActionBtn');
  const syncNowBtn = byId('syncNowBtn');

  if (authStatus && authActionBtn) {
    if (window.state.user) {
      authStatus.textContent = `Signed in as ${window.state.user.displayName || window.state.user.email}. Your timers sync automatically.`;
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

// Make sync functions available globally for storage module
window.syncToFirestore = syncToFirestore;
window.syncFromFirestore = syncFromFirestore;