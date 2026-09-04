import { describe, expect, it } from 'vitest';
import { buildTempoMap, secondsAt } from './player';
import type { SongSnapshot } from '@/lib/wasm/types';

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
  tracks: [{
    index: 0,
    name: 'Tempo test',
    instrument: { name: 'Piano', program: 0, channel: 0 },
    mml: 't120c4t60d4',
    mml_note_length: 2,
    playback_events: [
      { type: 'tempo', bpm: 120, position_units: 0 },
      { type: 'tempo', bpm: 60, position_units: 16 },
    ],
  }],
};

describe('audio timeline', () => {
  it('integrates tempo changes without accumulating frame-based drift', () => {
    const tempos = buildTempoMap(snapshot);
    expect(secondsAt(16, tempos, 64)).toBeCloseTo(0.5, 8);
    expect(secondsAt(32, tempos, 64)).toBeCloseTo(1.5, 8);
    expect(secondsAt(48, tempos, 64)).toBeCloseTo(2.5, 8);
  });

  it('uses the last tempo event at a duplicate position deterministically', () => {
    const duplicate = structuredClone(snapshot);
    duplicate.tracks[0].playback_events.push({ type: 'tempo', bpm: 240, position_units: 16 });
    expect(secondsAt(32, buildTempoMap(duplicate), 64)).toBeCloseTo(0.75, 8);
  });
});
