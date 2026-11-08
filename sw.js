// 離線快取。策略：有網路就拿最新版（跳過瀏覽器 HTTP 快取），3 秒內拿不到或離線才用快取。
// GitHub Pages 會讓瀏覽器把檔案快取 10 分鐘（max-age=600），所以所有請求都要帶 cache: 'no-cache'
// 或 'reload'，否則會把舊檔案當成新版存起來。
// 改了任何檔案就把 VERSION 加一，並同步改 js/app.js 的 APP_VERSION（有測試檢查兩者一致）。
const VERSION = 'v8';
const CACHE = `pocket-ledger-${VERSION}`;
const NETWORK_TIMEOUT = 3000;
const ASSETS = [
  './',
  'index.html',
  'css/style.css',
  'js/app.js',
  'js/core.js',
  'js/store.js',
  'manifest.webmanifest',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('pocket-ledger-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // 匯率 API 不經快取
  e.respondWith(networkFirst(e.request));
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  const key = request.mode === 'navigate' ? 'index.html' : request;
  const network = fetch(request.url, { cache: 'no-cache' }).then((res) => {
    if (res.ok) cache.put(key, res.clone());
    return res;
  });
  network.catch(() => {}); // 已改用快取時，忽略之後的網路錯誤
  const timeout = new Promise((resolve) => setTimeout(resolve, NETWORK_TIMEOUT, null));
  try {
    const res = await Promise.race([network, timeout]);
    if (res) return res;
  } catch {
    // 離線：往下用快取
  }
  const cached = await cache.match(key, { ignoreSearch: true });
  return cached || network; // 沒快取就繼續等網路
}
