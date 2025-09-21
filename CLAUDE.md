# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Progressive Web App (PWA) for time block timers built as a single-page application with vanilla JavaScript and Firebase integration. The app uses a Gruvbox Material color theme and supports both light and dark modes.

## Development Setup

This is a static web application with no build process. Simply open `index.html` in a browser to run locally:

```bash
# Serve locally (any static server)
python -m http.server 8000
# or
npx serve .
```

## Architecture

### File Structure
- `index.html` - Complete HTML structure with inline CSS and Firebase module imports
- `app.js` - All JavaScript functionality in a single IIFE (Immediately Invoked Function Expression)

### Core Architecture Patterns

**Single Page Application (SPA):**
- Hash-based routing (`#/list`, `#/edit/id`, `#/run/id`, `#/settings`)
- Page switching via `show(pageId)` function that toggles CSS classes
- State managed in global `state` object with reactive updates

**Data Layer:**
- **Primary Storage:** localStorage (offline-first PWA approach)
- **Sync Layer:** Firebase Firestore (when user is authenticated)
- **Auto-sync:** All saves automatically sync to Firestore if user is signed in
- **Conflict Resolution:** Local data takes precedence on merge

**State Management:**
```javascript
const state = {
  timers: [], // Array of timer objects
  prefs: {}, // User preferences (theme, audio, etc.)
  route: { page: 'list', id: null }, // Current route
  user: null // Firebase auth user
}
```

### Key Components

**Timer Structure:**
```javascript
{
  id: "unique-id",
  name: "Timer Name",
  blocks: [
    { atSeconds: 0, colorHex: "#color", label: "Block Label" }
  ],
  createdAt: timestamp,
  updatedAt: timestamp
}
```

**Block Rules:**
- First block is always at 0 seconds (start time)
- First block time inputs are disabled and delete button is hidden
- Blocks must be in ascending time order
- Each block defines a color change at a specific time

**Firebase Integration:**
- Auth via Google Sign-in popup
- Data stored at `/users/{userId}` with `{ timers: [], prefs: {}, updatedAt: timestamp }`
- Firebase modules imported via ES6 modules in `index.html`
- Global `window.firebaseApp` object provides Firebase APIs to main app

**Timer Engine:**
- Located in `Engine` object (lines ~477-543 in app.js)
- Handles play/pause/reset and automatic block transitions
- Uses `setTimeout` for block changes and `setInterval` for UI updates
- Manages wake lock API to prevent screen sleep during timer runs
- Full-screen color display during timer execution

## Code Organization (app.js sections)

1. **Utilities** - Helper functions (`$`, `$$`, `byId`, time formatting)
2. **Storage** - localStorage functions with Firebase auto-sync
3. **Firebase Auth & Sync** - Authentication and Firestore integration
4. **App State** - Global state object and drafts cache
5. **Validation** - Timer validation with first-block protection
6. **Router** - Hash-based SPA routing
7. **Render** - Page rendering functions (List, Edit, Run, Settings)
8. **Run Engine** - Timer execution logic
9. **Event Wiring** - Button click handlers and interactions

## UI/UX Architecture

**Theme System:**
- CSS custom properties for Gruvbox Material colors
- `[data-theme="light"]` attribute toggles themes
- System/light/dark theme preference stored in user prefs

**Responsive Design:**
- Desktop: Grid-based layouts with fixed sidebars
- Mobile: Single-column stacked layouts (768px breakpoint)
- Block editor uses CSS Grid that collapses to vertical stack on mobile

**Loading Screen:**
- Conditional display (only shows if initialization >120ms)
- Animated progress bar with Gruvbox colors
- Hidden via `display:none` initially, shown with `display:flex`

**Color Selection:**
- Custom popover with 26 curated Gruvbox Material colors
- Grid layout with hover effects and selection states
- Fallback to native color picker for custom colors

**Time Input:**
- H:M:S format with individual number inputs
- First block (0:0:0) has disabled time inputs
- Conversion helpers between total seconds and H:M:S components

## Firebase Configuration

Firebase is initialized via ES6 modules in `index.html` with project ID `color-block-timer`. The configuration includes:
- Authentication with Google provider
- Firestore database for user data sync
- Analytics integration

Required Firestore security rules:
```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

## Key Functions for Modification

- `renderEdit(id)` - Timer configuration UI (lines ~300-350)
- `blockRow(block, idx, tid)` - Individual block row generation
- `Engine` object methods - Timer execution logic
- `validateTimer(timer)` - Validation rules
- `syncToFirestore()` / `syncFromFirestore()` - Data synchronization

## Accessibility Features

- ARIA labels and descriptions throughout
- Screen reader announcements via `live()` function
- Keyboard navigation support
- High contrast color schemes
- Focus management for modal interactions