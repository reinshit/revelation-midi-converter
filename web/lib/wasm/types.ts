export interface SongOptions {
  auto_boot_velocity: boolean;
  auto_equalize_note_length: boolean;
  velocity_min: number;
  velocity_max: number;
  min_gap_for_chord: number;
  smallest_unit: number;
}

export interface InstrumentSnapshot {
  name: string;
  program: number;
  channel: number;
}

export interface TrackSnapshot {
  index: number;
  name: string;
  instrument: InstrumentSnapshot;
  mml: string;
  mml_note_length: number;
  playback_events: PlaybackEvent[];
}

export type PlaybackEvent =
  | {
      type: 'note';
      key: number;
      velocity: number;
      position_units: number;
      duration_units: number;
      char_start: number;
      char_end: number;
    }
  | { type: 'tempo'; bpm: number; position_units: number }
  | { type: 'program'; program: number; channel: number; position_units: number };

export interface SongSnapshot {
  api_version: 1;
  ppq: number;
  options: SongOptions;
  tracks: TrackSnapshot[];
}

export const defaultSongOptions: SongOptions = {
  auto_boot_velocity: false,
  auto_equalize_note_length: false,
  velocity_min: 0,
  velocity_max: 15,
  min_gap_for_chord: 0,
  smallest_unit: 64,
};
