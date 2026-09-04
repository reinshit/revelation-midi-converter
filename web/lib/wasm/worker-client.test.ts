import { describe, expect, it } from 'vitest';
import type { ConverterRequest, ConverterResponse } from './protocol';
import { ConverterWorkerClient } from './worker-client';
import type { SongSnapshot } from './types';

const snapshot: SongSnapshot = {
  api_version: 1,
  ppq: 480,
  options: {
    auto_boot_velocity: false,
    auto_equalize_note_length: false,
    velocity_min: 0,
    velocity_max: 15,
    min_gap_for_chord: 0,
    smallest_unit: 64,
  },
  tracks: [],
};

class FakeWorker {
  onmessage: ((event: MessageEvent<ConverterResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly requests: ConverterRequest[] = [];
  terminated = false;
  respond = true;

  postMessage(request: ConverterRequest) {
    this.requests.push(request);
    if (!this.respond) return;
    queueMicrotask(() => this.onmessage?.({ data: { id: request.id, ok: true, snapshot } } as MessageEvent<ConverterResponse>));
  }

  terminate() {
    this.terminated = true;
  }

  crash() {
    this.onerror?.({ type: 'error' } as ErrorEvent);
  }
}

describe('ConverterWorkerClient recovery', () => {
  it('reloads source and replays confirmed mutations before the next operation', async () => {
    const workers: FakeWorker[] = [];
    const client = new ConverterWorkerClient(() => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker as unknown as Worker;
    });

    await client.load(Uint8Array.from([1, 2, 3]).buffer);
    await client.renameTrack(0, 'Lead');
    workers[0].crash();
    await client.splitTrack(0);

    expect(workers).toHaveLength(2);
    expect(workers[0].terminated).toBe(true);
    expect(workers[1].requests.map((request) => request.type)).toEqual([
      'load',
      'renameTrack',
      'splitTrack',
    ]);
    client.dispose();
  });

  it('restarts after a timeout and does not replay an unconfirmed mutation', async () => {
    const workers: FakeWorker[] = [];
    const client = new ConverterWorkerClient(() => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker as unknown as Worker;
    }, 5);

    await client.load(Uint8Array.from([1, 2, 3]).buffer);
    workers[0].respond = false;
    await expect(client.renameTrack(0, 'Unconfirmed')).rejects.toMatchObject({ code: 'WORKER_TIMEOUT' });
    await client.splitTrack(0);

    expect(workers).toHaveLength(2);
    expect(workers[1].requests.map((request) => request.type)).toEqual(['load', 'splitTrack']);
    client.dispose();
  });
});
