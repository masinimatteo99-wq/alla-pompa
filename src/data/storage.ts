import { openDB } from 'idb';
import type { DBSchema, IDBPDatabase } from 'idb';
import { emptyArchive, validateArchive } from './archive';
import type { Archive } from './archive';

export interface StoredArchive {
  schemaVersion: 1;
  revision: number;
  data: Archive;
}

interface DiaryDB extends DBSchema {
  diary: { key: string; value: StoredArchive };
}

let connection: Promise<IDBPDatabase<DiaryDB>> | undefined;
function database() {
  connection ??= openDB<DiaryDB>('alla-pompa', 1, {
    upgrade(db) { db.createObjectStore('diary'); },
    blocking() {
      void connection?.then((db) => db.close());
      connection = undefined;
    },
    terminated() { connection = undefined; },
  }).catch((error: unknown) => { connection = undefined; throw error; });
  return connection;
}

export async function loadArchive(): Promise<StoredArchive> {
  const db = await database();
  const stored = await db.get('diary', 'archive');
  if (!stored) return { schemaVersion: 1, revision: 0, data: emptyArchive() };
  if (stored.schemaVersion !== 1 || !Number.isSafeInteger(stored.revision) || stored.revision < 1) {
    throw new Error('Versione dell’archivio locale non supportata.');
  }
  return { ...stored, data: validateArchive(stored.data) };
}

/** Una sola transazione per scrittura/ripristino, con controllo delle altre schede. */
export async function saveArchive(data: Archive, expectedRevision: number): Promise<StoredArchive> {
  const validated = validateArchive(data);
  const db = await database();
  const tx = db.transaction('diary', 'readwrite');
  // Un errore della richiesta può rigettare anche tx.done prima che sia raggiunto
  // il relativo await. Gestiamo subito la promessa, senza nascondere il fallimento.
  void tx.done.catch(() => {});
  const current = await tx.store.get('archive');
  if ((current?.revision ?? 0) !== expectedRevision) {
    tx.abort();
    await tx.done.catch(() => {});
    throw new Error('Il diario è cambiato in un’altra scheda. Ricarica la pagina prima di salvare.');
  }
  const stored: StoredArchive = { schemaVersion: 1, revision: expectedRevision + 1, data: validated };
  await tx.store.put(stored, 'archive');
  await tx.done;
  return stored;
}
