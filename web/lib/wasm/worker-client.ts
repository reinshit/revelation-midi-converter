import type { ConverterMutation, ConverterRequest, ConverterResponse } from './protocol';
import { defaultSongOptions } from './types';
import type { SongOptions, SongSnapshot } from './types';

type RequestPayload = ConverterRequest extends infer Request
  ? Request extends { id: number }
    ? Omit<Request, 'id'>
    : never
  : never;

export class ConverterWorkerClient {
  private worker: Worker;
  private recovering: Promise<void> = Promise.resolve();
  private disposed = false;
  private nextId = 1;
  private sourceBytes: ArrayBuffer | undefined;
  private initialOptions: SongOptions = defaultSongOptions;
  private mutations: ConverterMutation[] = [];
  private readonly pending = new Map<
    number,
    {
      resolve: (snapshot: SongSnapshot) => void;
      reject: (error: Error) => void;
      timeout: ReturnType<typeof setTimeout>;
    }
  >();

  constructor(
    private readonly workerFactory: () => Worker = createWorker,
    private readonly requestTimeoutMs = 30_000,
  ) {
    this.worker = this.workerFactory();
    this.bindWorkerEvents();
  }

  async load(bytes: ArrayBuffer, options?: SongOptions) {
    const retainedBytes = bytes.slice(0);
    const result = await this.request({ type: 'load', bytes, options }, [bytes]);
    this.sourceBytes = retainedBytes;
    this.initialOptions = { ...(options ?? defaultSongOptions) };
    this.mutations = [];
    return result;
  }

  async updateOptions(options: SongOptions) {
    return this.record({ type: 'updateOptions', options });
  }

  async splitTrack(index: number) {
    return this.record({ type: 'splitTrack', index });
  }

  async mergeTracks(indexA: number, indexB: number) {
    return this.record({ type: 'mergeTracks', indexA, indexB });
  }

  async equalizeTracks(indexA: number, indexB: number) {
    return this.record({ type: 'equalizeTracks', indexA, indexB });
  }

  async renameTrack(index: number, name: string) {
    return this.record({ type: 'renameTrack', index, name });
  }

  async applyKeymap(trackIndex: number, mapping: Record<number, number>) {
    return this.record({ type: 'applyKeymap', trackIndex, mapping });
  }

  getProjectState() {
    if (!this.sourceBytes) throw Object.assign(new Error('No MIDI project is loaded'), { code: 'SONG_NOT_LOADED' });
    return {
      sourceBytes: this.sourceBytes.slice(0),
      initialOptions: { ...this.initialOptions },
      mutations: structuredClone(this.mutations),
    };
  }

  async restore(sourceBytes: ArrayBuffer, initialOptions: SongOptions, mutations: ConverterMutation[]) {
    let snapshot = await this.load(sourceBytes, initialOptions);
    for (const mutation of mutations) snapshot = await this.record(mutation);
    return snapshot;
  }

  dispose() {
    this.disposed = true;
    this.rejectAll('WORKER_DISPOSED', 'Converter worker was disposed');
    this.worker.terminate();
  }

  private async request(payload: RequestPayload, transfer: Transferable[] = []) {
    await this.recovering;
    return this.sendRequest(payload, transfer);
  }

  private sendRequest(payload: RequestPayload, transfer: Transferable[] = []) {
    const id = this.nextId++;
    const request = { ...payload, id } as ConverterRequest;
    return new Promise<SongSnapshot>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(Object.assign(new Error('Converter request timed out'), { code: 'WORKER_TIMEOUT' }));
        this.restartWorker('WORKER_TIMEOUT', 'Converter worker timed out');
      }, this.requestTimeoutMs);
      this.pending.set(id, { resolve, reject, timeout });
      this.worker.postMessage(request, transfer);
    });
  }

  private async record(mutation: ConverterMutation) {
    const snapshot = await this.request(mutation);
    this.mutations.push(structuredClone(mutation));
    return snapshot;
  }

  private rejectAll(code: string, message: string) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(Object.assign(new Error(message), { code }));
    }
    this.pending.clear();
  }

  private bindWorkerEvents() {
    this.worker.onmessage = (event: MessageEvent<ConverterResponse>) => {
      const response = event.data;
      const pending = this.pending.get(response.id);
      if (!pending) return;
      clearTimeout(pending.timeout);
      this.pending.delete(response.id);
      if (response.ok) pending.resolve(response.snapshot);
      else pending.reject(Object.assign(new Error(response.error.message), { code: response.error.code }));
    };
    this.worker.onerror = () => {
      this.restartWorker('WORKER_FAILED', 'Converter worker stopped unexpectedly');
    };
  }

  private restartWorker(code: string, message: string) {
    this.rejectAll(code, message);
    this.worker.terminate();
    if (this.disposed) return;
    this.worker = this.workerFactory();
    this.bindWorkerEvents();
    this.recovering = this.restoreWorkerState();
  }

  private async restoreWorkerState() {
    if (!this.sourceBytes) return;
    await this.sendRequest(
      { type: 'load', bytes: this.sourceBytes.slice(0), options: this.initialOptions },
      [],
    );
    for (const mutation of this.mutations) await this.sendRequest(mutation);
  }
}

function createWorker() {
  return new Worker(new URL('../../workers/converter.worker.ts', import.meta.url), {
    type: 'module',
    name: 'reve-midi-converter',
  });
}
