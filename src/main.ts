import '@fontsource/roboto-mono/latin-400.css';
import '@fontsource/roboto-mono/latin-500.css';
import './style.css';
import { parseThousandths } from './domain/calculations';
import type { Refueling } from './domain/models';
import { calculateArchive, exportBackup, importBackup, measurementRecords, removeRefueling, sortedRefuelings } from './data/archive';
import type { Archive } from './data/archive';
import { loadArchive, saveArchive } from './data/storage';
import type { StoredArchive } from './data/storage';
import { createIdentifier } from './data/identifier';
import { setupPwa } from './pwa';
import type { PwaState } from './pwa';

const root = document.querySelector<HTMLDivElement>('#app')!;
const modal = document.createElement('dialog');
modal.className = 'modal';
document.body.append(modal);
const notification = document.createElement('p');
notification.className = 'notification';
notification.setAttribute('role', 'status');
document.body.append(notification);
let noticeTimeout: ReturnType<typeof setTimeout>;
let stored: StoredArchive;
let saving = false;

const number = (value: number, digits = 2) => new Intl.NumberFormat('it-IT', {
  minimumFractionDigits: digits, maximumFractionDigits: digits,
}).format(value);
const money = (value: number) => `${number(value)} €`;
const dateLabel = (date: string) => date.split('-').reverse().join('.');
const escape = (value: string) => value.replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]!);
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Operazione non riuscita. Riprova.';
const localDate = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};
const localTime = () => new Date().toTimeString().slice(0, 5);

function notify(message: string) {
  clearTimeout(noticeTimeout);
  notification.textContent = message;
  notification.classList.add('visible');
  noticeTimeout = setTimeout(() => notification.classList.remove('visible'), 5000);
}

async function commit(data: Archive, message: string) {
  if (saving) return;
  saving = true;
  const buttons = [...modal.querySelectorAll<HTMLButtonElement>('button')];
  buttons.forEach((button) => { button.disabled = true; });
  try {
    stored = await saveArchive(data, stored.revision);
    modal.close();
    render();
    notify(message);
  } finally {
    saving = false;
    buttons.forEach((button) => { button.disabled = false; });
  }
}

function render() {
  const { data } = stored;
  const result = calculateArchive(data);
  const average = result.average;
  const latest = result.intervals.at(-1);
  const records = measurementRecords(data).reverse();
  root.innerHTML = `
    <main class="receipt" aria-label="Diario dei consumi">
      <header class="receipt-header">
        <div class="eyebrow">DIARIO DI BORDO / N° 001</div>
        <div class="brand-row"><h1>ALLA POMPA<span class="brand-dot">.</span></h1>
          <button class="icon-button" data-action="settings" aria-label="Impostazioni e backup" title="Impostazioni e backup">☰</button></div>
        <p class="vehicle">${escape(data.vehicle.name)}</p>
      </header>
      <section class="hero" aria-labelledby="consumption-title">
        <h2 id="consumption-title" class="eyebrow">CONSUMO MEDIO STORICO</h2>
        <div class="consumption">${average ? number(average.kmPerLiter) : '—,—'}</div>
        <div class="unit">KM / L</div>
        <p class="hero-note">${average
          ? `${number(average.litersPer100Km)} L/100 km · ${number(average.distanceKm, 0)} km misurati`
          : 'Ogni pieno racconta un pezzo di strada.'}</p>
        <p class="status-line"><span aria-hidden="true">${average ? '●' : '○'}</span> ${average
          ? `${result.intervals.length} ${result.intervals.length === 1 ? 'intervallo completo' : 'intervalli completi'}${result.status === 'awaiting-full' ? ' · uno in corso' : result.status === 'no-reference' ? ' · serve un nuovo pieno' : ''}`
           : result.status === 'awaiting-full' ? 'In attesa del prossimo pieno completo' : records.length ? 'Nessuna misura valida · serve un pieno di riferimento' : 'Serve un pieno completo di riferimento'}</p>
      </section>
      <div class="summary strip">
        <div><span class="eyebrow">SPESA REGISTRATA</span><strong>${money(result.totalRecordedCostEuros)}</strong></div>
         <div><span class="eyebrow">€/KM MEDIO</span><strong>${average ? `${number(average.purchaseCostPerKm, 3)} €` : '—'}</strong></div>
      </div>
       ${latest ? `<section class="last-interval strip"><h2 class="eyebrow">ULTIMO INTERVALLO COMPLETO</h2><p>${number(latest.distanceKm, 0)} km · ${number(latest.liters)} L · <strong>${number(latest.litersPer100Km)} L/100 km</strong> · <span class="interval-cost">${number(latest.purchaseCostPerKm, 3)} €/km</span></p></section>` : ''}
      <button class="add-button" data-action="add"><span aria-hidden="true">＋</span> AGGIUNGI RIFORNIMENTO</button>
      <section class="history" aria-labelledby="history-title">
        <div class="section-heading"><h2 id="history-title">RIFORNIMENTI</h2><span>${String(records.length).padStart(2, '0')} VOCI</span></div>
        <div class="history-scroll" role="region" aria-label="Elenco rifornimenti scorrevole" tabindex="0">
        ${records.length ? `<ol class="records">${records.map((r) => {
          const interval = result.intervals.find((entry) => entry.endId === r.id);
          const trend = interval?.trend ? {
            improved: { symbol: '↑', label: 'Consumo migliorato rispetto all’intervallo precedente' },
            worse: { symbol: '↓', label: 'Consumo peggiorato rispetto all’intervallo precedente' },
            equal: { symbol: '=', label: 'Consumo uguale all’intervallo precedente' },
          }[interval.trend] : null;
          const cost = parseThousandths(r.liters) * parseThousandths(r.pricePerLiter) / 1_000_000;
          return `<li><button class="record" data-action="edit" data-id="${escape(r.id)}" aria-label="Modifica rifornimento del ${dateLabel(r.date)}">
            <div class="record-top"><time datetime="${r.date}">${dateLabel(r.date)}</time><span class="badge">${r.full ? 'PIENO' : 'PARZIALE'}</span></div>
            <div class="record-main"><span>${number(parseThousandths(r.liters) / 1000)} <small>L</small></span><strong>${money(cost)}</strong></div>
            <div class="record-bottom"><span>${number(r.odometerKm, 0)} km · ${number(parseThousandths(r.pricePerLiter) / 1000, 3)} €/L</span></div>
            ${interval ? `<p class="interval-note consumption-line"><span>${number(interval.litersPer100Km)} L/100 km su ${number(interval.distanceKm, 0)} km</span>${trend ? `<span class="consumption-trend trend-${interval.trend}" role="img" aria-label="${trend.label}" title="${trend.label}">${trend.symbol}</span>` : ''}</p>` : ''}
            ${r.breakBefore ? '<p class="interval-note">↳ Nuovo riferimento · storico interrotto</p>' : ''}
          </button></li>`;
         }).join('')}</ol>` : `<div class="empty-state"><p>IL VIAGGIO COMINCIA QUI</p><p>Data, chilometri e litri.<br>Al secondo pieno, il primo consumo.</p></div>`}
        </div>
      </section>
      <footer class="receipt-footer"><button class="method-button" data-action="method">Come leggiamo i dati ↗</button><div class="barcode" aria-hidden="true"></div></footer>
    </main>`;
}

function openDialog(title: string, contents: string) {
  modal.innerHTML = `<div class="modal-heading"><h2 id="dialog-title">${title}</h2><button class="icon-button" data-close aria-label="Chiudi">×</button></div>${contents}<p class="form-error" role="alert"></p>`;
  modal.setAttribute('aria-labelledby', 'dialog-title');
  modal.querySelector('[data-close]')?.addEventListener('click', () => { if (!saving) modal.close(); });
  if (!modal.open) modal.showModal();
}

function showError(error: unknown) {
  modal.querySelector('.form-error')!.textContent = errorMessage(error);
}

function editRefueling(record?: Refueling) {
  const latest = sortedRefuelings(stored.data.refuelings).at(-1);
  openDialog(record ? 'MODIFICA RIFORNIMENTO' : 'NUOVO RIFORNIMENTO', `
    <form id="refueling-form">
      <div class="form-grid date-time-grid"><label>Data<input name="date" type="date" required value="${record?.date ?? localDate()}" /></label>
      <label>Ora <span class="optional">(facoltativa)</span><input name="time" type="time" step="60" value="${record?.time ?? (record ? '' : localTime())}" /></label></div>
      <label>Contachilometri totali <span class="optional">km</span><input name="odometer" inputmode="numeric" pattern="[0-9]+" required placeholder="es. 39500" value="${record?.odometerKm ?? ''}" /></label>
      <p class="field-hint">${latest ? `Ultima lettura: ${number(latest.odometerKm, 0)} km. ` : ''}Usa i km totali, non quelli del viaggio.</p>
      <div class="form-grid"><label>Litri<input name="liters" inputmode="decimal" required placeholder="es. 37,08" value="${escape(record?.liters ?? '')}" /></label>
      <label>Prezzo €/L<input name="price" inputmode="decimal" required placeholder="es. 1,989" value="${escape(record?.pricePerLiter ?? '')}" /></label></div>
      <p class="cost-preview">TOTALE <output id="cost-preview">—</output></p>
      <label class="checkbox"><input name="full" type="checkbox" ${!record || record.full ? 'checked' : ''} /><span>Ho fatto il pieno<small>Serbatoio riportato al livello di pieno, non solo un importo fisso.</small></span></label>
      <label class="checkbox"><input name="break" type="checkbox" ${record?.breakBefore ? 'checked' : ''} /><span>Manca un rifornimento precedente<small>Interrompe la misura: si riparte da un pieno completo.</small></span></label>
      <button class="primary-button" type="submit">${record ? 'SALVA MODIFICHE' : 'REGISTRA RIFORNIMENTO'}</button>
      ${record ? '<button type="button" class="text-button danger" id="delete-record">Elimina registrazione</button>' : ''}
    </form>`);
  const form = modal.querySelector<HTMLFormElement>('form')!;
  const timeInput = form.querySelector<HTMLInputElement>('[name=time]')!;
  timeInput.addEventListener('change', () => {
    // Safari può conservare segmenti incompleti nel controllo nativo svuotato.
    if (!timeInput.value) timeInput.value = '';
  });
  const preview = () => {
    const fields = new FormData(form);
    let total = '—';
    try {
      const value = parseThousandths(String(fields.get('liters'))) * parseThousandths(String(fields.get('price')));
      if (Number.isSafeInteger(value)) total = money(value / 1_000_000);
    } catch { /* Campi ancora incompleti: l'anteprima rimane vuota. */ }
    modal.querySelector('output')!.textContent = total;
  };
  form.addEventListener('input', preview);
  preview();
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void (async () => {
      try {
        const fields = new FormData(form);
        const time = String(fields.get('time'));
        const newRecord: Refueling = {
          id: record?.id ?? createIdentifier(), date: String(fields.get('date')),
          ...(time ? { time } : {}), odometerKm: Number(fields.get('odometer')),
          liters: String(fields.get('liters')).trim(), pricePerLiter: String(fields.get('price')).trim(),
          full: fields.has('full'), breakBefore: fields.has('break'),
        };
        const records = stored.data.refuelings.filter((r) => r.id !== newRecord.id);
        records.push(newRecord);
        await commit({ ...stored.data, refuelings: records }, 'Rifornimento salvato sul dispositivo.');
      } catch (error) { showError(error); }
    })();
  });
  modal.querySelector('#delete-record')?.addEventListener('click', () => { if (record) confirmDelete(record); });
}

function confirmDelete(record: Refueling) {
  openDialog('ELIMINA REGISTRAZIONE', `<p>Rifornimento del ${dateLabel(record.date)}, ${number(record.odometerKm, 0)} km.</p>
    <p>Se l’acquisto è avvenuto davvero, la sua assenza interrompe la misura del consumo.</p>
    <label class="checkbox"><input type="checkbox" id="actual-purchase" checked /><span>È un acquisto realmente effettuato<small>Deseleziona solo per un duplicato o un inserimento errato.</small></span></label>
    <button class="primary-button danger" id="confirm-delete">CONFERMA ELIMINAZIONE</button>
    <button class="text-button" id="cancel-delete">Torna alla modifica</button>`);
  modal.querySelector('#cancel-delete')!.addEventListener('click', () => editRefueling(record));
  modal.querySelector('#confirm-delete')!.addEventListener('click', () => {
    void (async () => {
      try {
        const actual = modal.querySelector<HTMLInputElement>('#actual-purchase')!.checked;
        await commit(removeRefueling(stored.data, record.id, actual), 'Registrazione eliminata. Riepilogo ricalcolato.');
      } catch (error) { showError(error); }
    })();
  });
}

function downloadBackup() {
  const blob = new Blob([exportBackup(stored.data)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `alla-pompa-backup-${localDate()}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  notify('Backup generato. Conserva il file fuori dal browser.');
}

function settings() {
  openDialog('IL TUO DIARIO', `<form id="vehicle-form"><label>Nome del veicolo<input name="vehicle" maxlength="80" required value="${escape(stored.data.vehicle.name)}" /></label><button class="primary-button" type="submit">SALVA NOME</button></form>
    <hr /><h3>UNA COPIA, PER SICUREZZA.</h3><p>I dati restano in questo browser. La cancellazione dei dati del sito può rimuoverli: conserva un backup JSON.</p>
    <button class="secondary-button" id="export-backup">ESPORTA BACKUP JSON ↓</button>
    <label class="file-label" for="import-file">IMPORTA BACKUP JSON ↑</label><input class="file-input" id="import-file" type="file" accept=".json,application/json" />
    <p class="field-hint">Il ripristino sostituisce l’intero diario, dopo un controllo e una conferma. Non unisce due archivi.</p>
    <hr /><h3>APP E USO OFFLINE</h3>
    <p id="pwa-state" role="status"></p>
    <p class="field-hint">La cache conserva l’interfaccia; il diario resta in IndexedDB. Anche offline conserva un backup fuori dal browser.</p>
    <button class="secondary-button" id="install-help">INSTALLA SU IPHONE</button>
    <button class="secondary-button" id="check-update">CONTROLLA AGGIORNAMENTI</button>
    <button class="secondary-button" id="repair-offline" hidden>RIPREPARA OFFLINE</button>
    <div id="update-panel" hidden><p>È disponibile una nuova versione. Salva le modifiche prima di aggiornare. Il diario verrà conservato.</p>
    <button class="primary-button" id="apply-update">AGGIORNA E RICARICA</button></div>
    <p id="pwa-notice" role="status"></p>`);
  updatePwaUi(pwa.getState());
  modal.querySelector('#install-help')!.addEventListener('click', installHelp);
  modal.querySelector('#check-update')!.addEventListener('click', () => { void pwa.checkForUpdate(); });
  modal.querySelector('#repair-offline')!.addEventListener('click', () => { void pwa.repairOffline(); });
  modal.querySelector('#apply-update')!.addEventListener('click', () => pwa.applyUpdate());
  modal.querySelector('form')!.addEventListener('submit', (event) => {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget as HTMLFormElement).get('vehicle')).trim();
    void commit({ ...stored.data, vehicle: { ...stored.data.vehicle, name } }, 'Nome del veicolo aggiornato.').catch(showError);
  });
  modal.querySelector('#export-backup')!.addEventListener('click', downloadBackup);
  modal.querySelector('#import-file')!.addEventListener('change', (event) => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const revision = stored.revision;
    void (async () => {
      try {
        if (file.size > 5_000_000) throw new Error('Backup troppo grande: il limite è 5 MB.');
        const archive = importBackup(await file.text());
        if (modal.open) confirmImport(archive, revision);
      } catch (error) { showError(error); }
    })();
  });
}

function updatePwaUi(state: PwaState) {
  const label = modal.querySelector('#pwa-state');
  if (label) label.textContent = state.message;
  const panel = modal.querySelector<HTMLElement>('#update-panel');
  if (panel) panel.hidden = !state.updateAvailable;
  const update = modal.querySelector<HTMLButtonElement>('#apply-update');
  if (update) {
    update.disabled = state.updating;
    update.textContent = state.updating ? 'AGGIORNAMENTO IN CORSO…' : 'AGGIORNA E RICARICA';
  }
  const check = modal.querySelector<HTMLButtonElement>('#check-update');
  if (check) check.hidden = !import.meta.env.PROD;
  const repair = modal.querySelector<HTMLButtonElement>('#repair-offline');
  if (repair) repair.hidden = !state.canRepair;
}

function installHelp() {
  openDialog('ALLA POMPA SULLA HOME', `<p id="pwa-state" role="status"></p>
    <ol class="install-steps"><li>Apri l’indirizzo HTTPS di Alla pompa in <strong>Safari sull’iPhone</strong>.</li>
    <li>Apri <strong>Condividi → Aggiungi alla schermata Home</strong>. Se compare, attiva «Apri come app web», poi conferma.</li>
    <li>Apri Alla pompa dalla Home con la rete disponibile e attendi «Pronta per l’uso offline» nel menu del diario.</li>
    <li>Solo dopo questa conferma prova a chiuderla e riaprirla in modalità aereo.</li></ol>
    <p>Usa principalmente l’app dalla Home. Safari e l’app installata potrebbero avere archivi separati: se non trovi il diario, esporta il JSON dal contesto originale e importalo qui.</p>
    <p>Per i backup usa un file salvato sul dispositivo nell’app File. Un file disponibile solo su iCloud potrebbe richiedere la rete.</p>
    <p>Il sito deve essere su HTTPS. L’indirizzo locale del Mac serve soltanto per le prove sul computer.</p>
    <button class="secondary-button" id="back-settings">TORNA AL DIARIO</button>`);
  updatePwaUi(pwa.getState());
  modal.querySelector('#back-settings')!.addEventListener('click', settings);
}

function confirmImport(archive: Archive, revision: number) {
  const first = sortedRefuelings(archive.refuelings)[0];
  const last = sortedRefuelings(archive.refuelings).at(-1);
  openDialog('RIPRISTINA BACKUP', `<p><strong>${escape(archive.vehicle.name)}</strong></p><p>${archive.refuelings.length} rifornimenti${first && last ? `<br>Dal ${dateLabel(first.date)} al ${dateLabel(last.date)}` : ''}</p>
    <p>Sostituirà i tuoi ${stored.data.refuelings.length} rifornimenti attuali. Prima salva una copia del diario esistente.</p>
    <button class="secondary-button" id="before-import">ESPORTA IL DIARIO ATTUALE ↓</button>
    <label class="checkbox"><input type="checkbox" id="confirm-replace" /><span>Confermo la sostituzione completa del diario</span></label>
    <button class="primary-button" id="restore-backup">RIPRISTINA QUESTO BACKUP</button>`);
  modal.querySelector('#before-import')!.addEventListener('click', downloadBackup);
  modal.querySelector('#restore-backup')!.addEventListener('click', () => {
    void (async () => {
      try {
        if (!modal.querySelector<HTMLInputElement>('#confirm-replace')!.checked) throw new Error('Conferma la sostituzione prima di procedere.');
        if (revision !== stored.revision) throw new Error('Il diario è cambiato. Importa nuovamente il file.');
        await commit(archive, 'Backup ripristinato. Calcoli aggiornati.');
      } catch (error) { showError(error); }
    })();
  });
}

root.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]');
  if (!button || saving) return;
  if (button.dataset.action === 'add') editRefueling();
  if (button.dataset.action === 'settings') settings();
  if (button.dataset.action === 'method') {
    openDialog('COME LEGGIAMO I DATI', `<p>Misuriamo da pieno a pieno: litri aggiunti dopo il pieno iniziale, divisi per i chilometri percorsi. I parziali aspettano il pieno finale. La media usa litri e km totali degli intervalli completi.</p>
      <p>Il valore principale è in km/L; sotto trovi l’equivalente in L/100 km.</p>
      <p>Nello storico, ↑ verde indica un consumo migliorato, ↓ rossa un consumo peggiorato e = giallo un consumo uguale rispetto all’intervallo completo precedente. Il confronto usa i dati non arrotondati, includendo i parziali. Per il primo intervallo non c’è ancora un confronto.</p>
      <p>€/km indica la spesa di carburante acquistato negli intervalli completi, non il costo storico esatto della benzina bruciata. La spesa registrata include invece tutti gli acquisti.</p>
      <p>Per risultati confrontabili, fermati al primo arresto automatico della pompa. Se manca un rifornimento, segnala l’interruzione nel modulo successivo.</p>
      <p>I dati restano sul dispositivo. Puoi esportare un backup dal menu del diario.</p>`);
  }
  if (button.dataset.action === 'edit') {
    const record = stored.data.refuelings.find((r) => r.id === button.dataset.id);
    if (record) editRefueling(record);
  }
});

modal.addEventListener('cancel', (event) => { if (saving) event.preventDefault(); });

const pwa = setupPwa({
  onChange: updatePwaUi,
  onNotice: (message) => {
    notify(message);
    const label = modal.querySelector('#pwa-notice');
    if (label) label.textContent = message;
  },
  canReload: () => {
    if (saving) return false;
    if (!modal.open) return true;
    if (modal.querySelector('#refueling-form')) return false;
    const vehicle = modal.querySelector<HTMLInputElement>('[name=vehicle]');
    return !vehicle || vehicle.value === stored.data.vehicle.name;
  },
});

void loadArchive().then((value) => {
  stored = value;
  render();
}).catch((error: unknown) => {
  root.innerHTML = `<main class="receipt failure"><h1>DIARIO NON DISPONIBILE</h1><p>${escape(errorMessage(error))}</p><p>Non abbiamo aperto un diario vuoto al posto dei tuoi dati. Verifica che il browser consenta l’archiviazione locale e riprova.</p><button class="primary-button" id="retry">RIPROVA</button></main>`;
  root.querySelector('#retry')!.addEventListener('click', () => location.reload());
});
