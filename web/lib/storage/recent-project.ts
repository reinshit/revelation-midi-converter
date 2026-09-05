import type { ConverterMutation } from '@/lib/wasm/protocol';
import type { SongOptions } from '@/lib/wasm/types';
import type { RestoredProject } from './project';

const databaseName = 'reve-midi';
const projectStoreName = 'projects';
const keymapStoreName = 'keymaps';
const recentKey = 'recent';

interface StoredProject {
  name: string;
  sourceBytes: ArrayBuffer;
  initialOptions: SongOptions;
  mutations: ConverterMutation[];
  updatedAt: number;
}

export async function saveRecentProject(
  name: string,
  state: Omit<StoredProject, 'name' | 'updatedAt'>,
) {
  const database = await openDatabase();
  try {
    await transactionPromise(database, projectStoreName, 'readwrite', (store) =>
      store.put(
        { ...state, name, updatedAt: Date.now() } satisfies StoredProject,
        recentKey,
      ),
    );
  } finally {
    database.close();
  }
}

export async function loadRecentProject(): Promise<
  RestoredProject | undefined
> {
  const database = await openDatabase();
  let result: StoredProject | undefined;
  try {
    result = await transactionPromise<StoredProject | undefined>(
      database,
      projectStoreName,
      'readonly',
      (store) => store.get(recentKey),
    );
  } finally {
    database.close();
  }
  if (!result) return undefined;
  return {
    name: result.name,
    sourceBytes: result.sourceBytes,
    initialOptions: result.initialOptions,
    mutations: result.mutations,
  };
}

export async function saveKeymap(
  name: string,
  mapping: Record<number, number>,
) {
  const database = await openDatabase();
  try {
    await transactionPromise(database, keymapStoreName, 'readwrite', (store) =>
      store.put(mapping, name),
    );
  } finally {
    database.close();
  }
}

export async function loadKeymap(
  name: string,
): Promise<Record<number, number> | undefined> {
  const database = await openDatabase();
  let result: Record<number, number> | undefined;
  try {
    result = await transactionPromise<Record<number, number> | undefined>(
      database,
      keymapStoreName,
      'readonly',
      (store) => store.get(name),
    );
  } finally {
    database.close();
  }
  return result;
}

export function clearProjectData() {
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(databaseName);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(storageError(request.error));
    request.onblocked = () =>
      reject(new Error('Close other tabs using this app, then try again.'));
  });
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(projectStoreName))
        request.result.createObjectStore(projectStoreName);
      if (!request.result.objectStoreNames.contains(keymapStoreName))
        request.result.createObjectStore(keymapStoreName);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(storageError(request.error));
  });
}

function transactionPromise<T = IDBValidKey>(
  database: IDBDatabase,
  storeName: string,
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
) {
  return new Promise<T>((resolve, reject) => {
    const transaction = database.transaction(storeName, mode);
    const request = action(transaction.objectStore(storeName));
    let result: T;
    request.onsuccess = () => {
      result = request.result;
    };
    request.onerror = () => reject(storageError(request.error));
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(storageError(transaction.error));
    transaction.onabort = () => reject(storageError(transaction.error));
  });
}

function storageError(error: DOMException | null) {
  if (error?.name === 'QuotaExceededError')
    return new Error(
      'Browser storage is full. Export the project, then clear local data.',
    );
  return error ?? new Error('The browser storage operation failed');
}
