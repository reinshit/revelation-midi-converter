import type { SongOptions, SongSnapshot } from './types';

export type ConverterRequest =
  | { id: number; type: 'load'; bytes: ArrayBuffer; options?: SongOptions }
  | { id: number; type: 'snapshot' }
  | { id: number; type: 'updateOptions'; options: SongOptions }
  | { id: number; type: 'splitTrack'; index: number }
  | { id: number; type: 'mergeTracks'; indexA: number; indexB: number }
  | { id: number; type: 'equalizeTracks'; indexA: number; indexB: number }
  | { id: number; type: 'renameTrack'; index: number; name: string }
  | { id: number; type: 'applyKeymap'; trackIndex: number; mapping: Record<number, number> };

export type ConverterMutation =
  | { type: 'updateOptions'; options: SongOptions }
  | { type: 'splitTrack'; index: number }
  | { type: 'mergeTracks'; indexA: number; indexB: number }
  | { type: 'equalizeTracks'; indexA: number; indexB: number }
  | { type: 'renameTrack'; index: number; name: string }
  | { type: 'applyKeymap'; trackIndex: number; mapping: Record<number, number> };

export type ConverterResponse =
  | { id: number; ok: true; snapshot: SongSnapshot }
  | { id: number; ok: false; error: { code: string; message: string } };
