# Alla pompa

Diario dei rifornimenti per un veicolo, con calcolo dei consumi e dei costi
con il metodo da pieno a pieno. Installabile come PWA e utilizzabile offline.

## Funzionalità

- Inserimento, modifica ed eliminazione dei rifornimenti, pieni e parziali.
- Consumi in km/L e L/100 km, spesa registrata e costo per chilometro.
- Storico, medie ponderate e confronto tra intervalli completi.
- Archivio locale ed esportazione e ripristino tramite backup JSON.

Il primo pieno stabilisce il riferimento; il successivo chiude l'intervallo.
Il calcolo include i parziali intermedi. Le medie si ottengono dai litri e dai
chilometri complessivi degli intervalli completi. La spesa registrata comprende
tutti gli acquisti, anche quelli che non rientrano ancora nei consumi misurati.

## Utilizzo

L'indirizzo dell'app è disponibile nella sezione **Deployments → github-pages**
del repository. Su iPhone, apri il sito in Safari e scegli
**Condividi → Aggiungi alla schermata Home**. Attendi lo stato
**«Pronta per l'uso offline»** nel menu prima di utilizzare l'app senza rete.

I dati restano nel browser, senza account o sincronizzazione. Esporta un backup
JSON per conservarne una copia: cancellare i dati del sito elimina il diario.
Browser, dispositivi e contesti Safari/Home possono avere archivi separati.
L'importazione di un backup sostituisce il diario presente.

## Sviluppo

Richiede Node.js 24 e npm.

```sh
npm ci
npm run dev
```

Verifiche e build:

```sh
npm run check
npx playwright install chromium webkit
npm run test:e2e
npm run publication:check
npm run build
```

Stack: TypeScript, Vite, IndexedDB e service worker.

## Pubblicazione

Il workflow **Pubblica Alla pompa su Pages**, avviabile dalla scheda **Actions**,
esegue i controlli e pubblica la build su GitHub Pages.
