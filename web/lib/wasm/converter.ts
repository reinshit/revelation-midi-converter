import initWasm, { WasmSong } from './pkg/reve_midi_wasm';
import type { SongOptions, SongSnapshot } from './types';

let initialization: Promise<unknown> | undefined;

async function initialize() {
  initialization ??= initWasm();
  await initialization;
}

export class MidiConverter {
  private constructor(private readonly song: WasmSong) {}

  static async load(bytes: Uint8Array, options?: SongOptions) {
    await initialize();
    return new MidiConverter(new WasmSong(bytes, options));
  }

  snapshot(): SongSnapshot {
    return this.song.snapshot() as SongSnapshot;
  }

  updateOptions(options: SongOptions): SongSnapshot {
    return this.song.update_options(options) as SongSnapshot;
  }

  splitTrack(index: number): SongSnapshot {
    return this.song.split_track(index) as SongSnapshot;
  }

  mergeTracks(indexA: number, indexB: number): SongSnapshot {
    return this.song.merge_tracks(indexA, indexB) as SongSnapshot;
  }

  equalizeTracks(indexA: number, indexB: number): SongSnapshot {
    return this.song.equalize_tracks(indexA, indexB) as SongSnapshot;
  }

  renameTrack(index: number, name: string): SongSnapshot {
    return this.song.rename_track(index, name) as SongSnapshot;
  }

  applyKeymap(trackIndex: number, mapping: Record<number, number>): SongSnapshot {
    const entries = Object.entries(mapping).map(([from, to]) => ({
      from: Number(from),
      to,
    }));
    return this.song.apply_keymap(trackIndex, entries) as SongSnapshot;
  }

  dispose() {
    this.song.free();
  }
}
