/* GestVoltic — guarda a aplicação no aparelho para abrir sem rede. Só guarda os ficheiros da aplicação (nunca os dados). */
const CACHE = 'gestvoltic-236';
const FICHEIROS = ['./', 'index.html', 'app.js', 'rtiebt.js', 'calculos.js', 'carregamento.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];
/* v164: «Partilhar» do Android. As fotografias ficam em espera só neste aparelho até se escolher a obra na aplicação. */
function abrirFila() {
  return new Promise((res, rej) => { const r = indexedDB.open('gestvoltic-partilha', 1); r.onupgradeneeded = () => r.result.createObjectStore('fila', { keyPath: 'id', autoIncrement: true }); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}
async function receberPartilha(pedido) {
  const destino = s => Response.redirect(new URL('./?partilha=' + s, self.registration.scope).href, 303);
  try {
    const fd = await pedido.formData(), fs = fd.getAll('fotos').filter(f => f && f.size && /^image\//.test(f.type));
    if (!fs.length) return destino('erro');
    const db = await abrirFila();
    await new Promise((res, rej) => { const t = db.transaction('fila', 'readwrite'), s = t.objectStore('fila'), em = new Date().toISOString(); fs.forEach(f => s.add({ em, nome: f.name, tipo: f.type, blob: f })); t.oncomplete = () => res(); t.onerror = () => rej(t.error); });
    return destino('1');
  } catch (_) { return destino('erro'); }
}
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FICHEIROS)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method === 'POST' && u.origin === location.origin && u.pathname.endsWith('/partilha')) return e.respondWith(receberPartilha(e.request));
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  if (u.searchParams.has('v')) return e.respondWith(fetch(e.request.url, { cache: 'no-store' }));   // v207: só para ver se há versão nova
  // primeiro a rede (para receber versões novas, sem esperar pela cache do navegador), sem rede o que está guardado
  const rede = e.request.mode === 'navigate' ? fetch(e.request) : fetch(e.request.url, { cache: 'no-cache' });
  e.respondWith(rede.then(r => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then(k => k.put(e.request, c)); } return r; })
    .catch(() => caches.match(e.request).then(r => r || caches.match('index.html'))));
});
