/*
 * Service worker do app do motorista (escopo /motorista/).
 * Estratégia: SEMPRE rede. Nada autenticado é guardado em cache (dados de
 * clientes e rotas não ficam no aparelho). Sem conexão, navegações mostram
 * uma página offline estática. Ações nunca são enfileiradas offline: o
 * servidor é a fonte da verdade.
 */
const CACHE = 'toalhas-offline-v1';
const OFFLINE_ASSETS = ['/offline.html', '/icons/icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(OFFLINE_ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || req.mode !== 'navigate') return;
  event.respondWith(fetch(req).catch(() => caches.match('/offline.html')));
});
