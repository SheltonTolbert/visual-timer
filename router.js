// Router module - hash-based SPA routing
export function go(page, id){
  window.state.route = { page, id: id||null };
  location.hash = '#/'+page + (id?('/'+id):'');
}

export function parseHash(){
  const h = location.hash.slice(2).split('/');
  const page = h[0]||'list';
  const id = h[1]||null;
  return { page, id };
}

export function setupRouting(renderCallback) {
  window.addEventListener('hashchange', renderCallback);
}

// Make go function available globally for event handlers
window.go = go;