/// <reference lib="webworker" />

import { MidiConverter } from '@/lib/wasm/converter';
import type { ConverterRequest, ConverterResponse } from '@/lib/wasm/protocol';

let converter: MidiConverter | undefined;

self.onmessage = async (event: MessageEvent<ConverterRequest>) => {
  const request = event.data;
  try {
    let snapshot;
    switch (request.type) {
      case 'load': {
        const next = await MidiConverter.load(new Uint8Array(request.bytes), request.options);
        converter?.dispose();
        converter = next;
        snapshot = converter.snapshot();
        break;
      }
      case 'snapshot':
        snapshot = current().snapshot();
        break;
      case 'updateOptions':
        snapshot = current().updateOptions(request.options);
        break;
      case 'splitTrack':
        snapshot = current().splitTrack(request.index);
        break;
      case 'mergeTracks':
        snapshot = current().mergeTracks(request.indexA, request.indexB);
        break;
      case 'equalizeTracks':
        snapshot = current().equalizeTracks(request.indexA, request.indexB);
        break;
      case 'renameTrack':
        snapshot = current().renameTrack(request.index, request.name);
        break;
      case 'applyKeymap':
        snapshot = current().applyKeymap(request.trackIndex, request.mapping);
        break;
    }
    respond({ id: request.id, ok: true, snapshot });
  } catch (error) {
    respond({ id: request.id, ok: false, error: normalizeError(error) });
  }
};

function current() {
  if (!converter) {
    throw Object.assign(new Error('Load a MIDI file before editing it'), {
      code: 'SONG_NOT_LOADED',
    });
  }
  return converter;
}

function normalizeError(error: unknown) {
  if (error instanceof Error) {
    const code = 'code' in error && typeof error.code === 'string' ? error.code : 'CONVERTER_FAILED';
    return { code, message: error.message };
  }
  return { code: 'CONVERTER_FAILED', message: String(error) };
}

function respond(response: ConverterResponse) {
  self.postMessage(response);
}

