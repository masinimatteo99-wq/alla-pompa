export interface PwaState {
  message: string;
  ready: boolean;
  updateAvailable: boolean;
  updating: boolean;
  canRepair: boolean;
}

/** La cache dell'interfaccia è separata da IndexedDB. Nessun ricaricamento automatico. */
export function setupPwa(options: {
  onChange: (state: PwaState) => void;
  onNotice: (message: string) => void;
  canReload: () => boolean;
}) {
  let registration: ServiceWorkerRegistration | undefined;
  let changedController = false;
  let reloadRequested = false;
  let controller = 'serviceWorker' in navigator ? navigator.serviceWorker.controller : null;
  let state: PwaState = {
    message: import.meta.env.PROD ? 'Preparazione per l’uso offline…' : 'Modalità sviluppo: offline disponibile nella build di produzione.',
    ready: false, updateAvailable: false, updating: false, canRepair: false,
  };
  const publish = (changes: Partial<PwaState>) => {
    state = { ...state, ...changes };
    options.onChange(state);
  };
  const base = new URL(import.meta.env.BASE_URL, location.origin);

  async function checkReady() {
    try {
      if (!registration?.active || !navigator.serviceWorker.controller) return;
      const names = await caches.keys();
      const name = names.find((entry) => entry.startsWith('workbox-precache-') && entry.endsWith(registration!.scope));
      if (!name) {
        publish({ ready: false, canRepair: true, message: 'Cache offline non disponibile. Collegati e usa «Riprepara offline».' });
        return;
      }
      const cache = await caches.open(name);
      const keys = await cache.keys();
      const required = ['index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png']
        .map((path) => new URL(path, base).href);
      const findKey = (url: string) => keys.find((key) => {
        const cached = new URL(key.url);
        const expected = new URL(url);
        return cached.origin === expected.origin && cached.pathname === expected.pathname;
      });
      // Legge le dipendenze dalla versione effettivamente in cache, anche quando
      // un'altra scheda ha aggiornato il worker ma questa pagina non è ricaricata.
      const indexKey = findKey(new URL('index.html', base).href);
      const index = indexKey ? await cache.match(indexKey) : undefined;
      if (index) {
        const document = new DOMParser().parseFromString(await index.text(), 'text/html');
        for (const element of document.querySelectorAll('script[src], link[rel=stylesheet]')) {
          required.push(new URL(element.getAttribute('src') ?? element.getAttribute('href')!, base).href);
        }
      }
      for (const key of keys.filter((entry) => new URL(entry.url).pathname.endsWith('.css'))) {
        const css = await cache.match(key);
        if (!css) continue;
        for (const match of (await css.text()).matchAll(/url\(["']?([^"')]+)["']?\)/g)) {
          if (!match[1]!.startsWith('data:')) required.push(new URL(match[1]!, key.url).href);
        }
      }
      const complete = Boolean(index) && (await Promise.all(required.map(async (url) => {
        const key = findKey(url);
        return key ? Boolean(await cache.match(key)) : false;
      }))).every(Boolean);
      publish({ ready: complete, canRepair: !complete, message: complete ? 'Pronta per l’uso offline' : 'Preparazione offline incompleta. Collegati e usa «Riprepara offline».' });
    } catch {
      publish({ ready: false, canRepair: true, message: 'Non è stato possibile verificare la cache offline. Riprova con la rete disponibile.' });
    }
  }

  function watch(worker: ServiceWorker | null) {
    if (!worker) return;
    const changed = () => {
      if (worker.state === 'installed' && registration?.waiting && navigator.serviceWorker.controller) {
        publish({ updateAvailable: true });
        options.onNotice('Aggiornamento disponibile nel menu del diario. Salva prima le modifiche.');
      }
      if (worker.state === 'activated') void checkReady();
      if (worker.state === 'redundant' && !state.ready) {
        publish({ canRepair: true, message: 'Preparazione offline non riuscita. Riprova con la rete disponibile.' });
      }
    };
    worker.addEventListener('statechange', changed);
    changed();
  }

  async function registerWorker() {
    try {
      const value = await navigator.serviceWorker.register(new URL('sw.js', base).href, { scope: base.pathname, updateViaCache: 'none' });
      registration = value;
      watch(value.installing);
      value.addEventListener('updatefound', () => watch(value.installing));
      if (value.waiting) publish({ updateAvailable: true });
      await checkReady();
    } catch {
      publish({ ready: false, canRepair: true, message: 'Preparazione offline non riuscita. Controlla la connessione e riprova.' });
    }
  }

  async function checkForUpdate(manual = true) {
    if (!registration) return;
    if (!navigator.onLine) {
      await checkReady();
      if (manual) options.onNotice('Sei offline. Potrai cercare aggiornamenti quando tornerà la rete.');
      return;
    }
    try {
      await registration.update();
      if (state.updateAvailable) options.onNotice('Aggiornamento disponibile. Puoi applicarlo dopo aver salvato le modifiche.');
      else if (manual) options.onNotice('Controllo eseguito. Eventuali nuove versioni saranno segnalate qui.');
    } catch {
      if (manual) options.onNotice('Controllo aggiornamenti non riuscito. Il diario locale resta disponibile.');
    }
    await checkReady();
  }

  if (import.meta.env.PROD) {
    if (!isSecureContext || !('serviceWorker' in navigator) || !('caches' in window)) {
      state.message = 'Offline non disponibile: apri l’app su HTTPS con un browser compatibile.';
    } else {
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        const hadController = Boolean(controller);
        controller = navigator.serviceWorker.controller;
        if (reloadRequested && options.canReload()) {
          location.reload();
          return;
        }
        // Anche se un'altra scheda aggiorna il worker, il modulo corrente resta aperto.
        if (hadController) {
          changedController = true;
          publish({ updateAvailable: true, updating: false });
        }
        void checkReady();
      });
      void registerWorker();
      window.addEventListener('online', () => { void checkForUpdate(false); });
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void checkForUpdate(false);
      });
    }
  }

  return {
    getState: () => state,
    checkForUpdate,
    async repairOffline() {
      if (!state.canRepair) return;
      if (!navigator.onLine || !options.canReload()) {
        options.onNotice('Per ripreparare l’app, collegati alla rete e salva o chiudi il modulo.');
        return;
      }
      publish({ canRepair: false, ready: false, message: 'Nuova preparazione offline in corso…' });
      try {
        // Il ricaricamento lascia il vecchio client prima di reinstallare lo stesso
        // worker: Chromium altrimenti può riutilizzare l'installazione senza cache.
        // IndexedDB e i file di backup non vengono toccati.
        const current = registration ?? await navigator.serviceWorker.getRegistration(base.href);
        await current?.unregister();
        location.reload();
      } catch {
        publish({ canRepair: true, message: 'Preparazione offline non riuscita. Riprova con la rete disponibile.' });
      }
    },
    applyUpdate() {
      if (!state.updateAvailable || state.updating) return;
      if (!options.canReload()) {
        options.onNotice('Salva o chiudi il modulo prima di aggiornare l’app.');
        return;
      }
      if (changedController) { location.reload(); return; }
      if (!registration?.waiting) {
        publish({ updateAvailable: false });
        options.onNotice('Nessun aggiornamento in attesa. Controlla nuovamente gli aggiornamenti.');
        return;
      }
      reloadRequested = true;
      publish({ updating: true });
      registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    },
  };
}
