import type { ConverterMutation } from '@/lib/wasm/protocol';
import type { SongOptions } from '@/lib/wasm/types';

interface ProjectDocument {
  schema_version: 1;
  source: { name: string; bytes_base64: string };
  initial_options: SongOptions;
  mutations: ConverterMutation[];
}

export interface RestoredProject {
  name: string;
  sourceBytes: ArrayBuffer;
  initialOptions: SongOptions;
  mutations: ConverterMutation[];
}

export function downloadProject(
  sourceName: string,
  state: { sourceBytes: ArrayBuffer; initialOptions: SongOptions; mutations: ConverterMutation[] },
) {
  download(
    new Blob([serializeProject(sourceName, state)], { type: 'application/json' }),
    `${stripExtension(sourceName)}.reve-midi.json`,
  );
}

export async function readProject(file: File): Promise<RestoredProject> {
  return parseProject(await file.text());
}

export function serializeProject(
  sourceName: string,
  state: { sourceBytes: ArrayBuffer; initialOptions: SongOptions; mutations: ConverterMutation[] },
) {
  const document: ProjectDocument = {
    schema_version: 1,
    source: { name: sourceName, bytes_base64: encodeBase64(state.sourceBytes) },
    initial_options: state.initialOptions,
    mutations: state.mutations,
  };
  return JSON.stringify(document);
}

export function parseProject(text: string): RestoredProject {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('The project is not valid JSON');
  }
  if (value && typeof value === 'object' && 'schema_version' in value && value.schema_version !== 1) {
    throw new Error(`Unsupported project schema version: ${String(value.schema_version)}`);
  }
  if (!isProjectDocument(value)) throw new Error('The project format is invalid or unsupported');
  let sourceBytes: ArrayBuffer;
  try {
    sourceBytes = decodeBase64(value.source.bytes_base64);
  } catch {
    throw new Error('The MIDI data in this project is corrupted');
  }
  return {
    name: value.source.name,
    sourceBytes,
    initialOptions: value.initial_options,
    mutations: value.mutations,
  };
}

export function downloadMml(sourceName: string, tracks: { name: string; mml: string }[]) {
  const content = tracks.map((track, index) => `# ${index + 1}. ${track.name}\n${track.mml}`).join('\n\n');
  download(new Blob([content], { type: 'text/plain;charset=utf-8' }), `${stripExtension(sourceName)}.mml.txt`);
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function encodeBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function decodeBase64(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

function stripExtension(name: string) {
  return name.replace(/\.[^.]+$/, '') || 'reve-midi-project';
}

function isProjectDocument(value: unknown): value is ProjectDocument {
  if (!value || typeof value !== 'object') return false;
  const document = value as Partial<ProjectDocument>;
  return (
    document.schema_version === 1 &&
    typeof document.source?.name === 'string' &&
    document.source.name.length > 0 &&
    typeof document.source.bytes_base64 === 'string' &&
    document.source.bytes_base64.length > 0 &&
    isSongOptions(document.initial_options) &&
    Array.isArray(document.mutations) &&
    document.mutations.every(isMutation)
  );
}

function isSongOptions(value: unknown): value is SongOptions {
  if (!value || typeof value !== 'object') return false;
  const options = value as Partial<SongOptions>;
  return (
    typeof options.auto_boot_velocity === 'boolean' &&
    typeof options.auto_equalize_note_length === 'boolean' &&
    isIntegerInRange(options.velocity_min, 0, 15) &&
    isIntegerInRange(options.velocity_max, 0, 15) &&
    options.velocity_min! <= options.velocity_max! &&
    isIntegerInRange(options.min_gap_for_chord, 0, 65_535) &&
    isIntegerInRange(options.smallest_unit, 1, 65_535)
  );
}

function isMutation(value: unknown): value is ConverterMutation {
  if (!value || typeof value !== 'object' || !('type' in value)) return false;
  const mutation = value as Record<string, unknown>;
  switch (mutation.type) {
    case 'updateOptions': return isSongOptions(mutation.options);
    case 'splitTrack': return isIndex(mutation.index);
    case 'mergeTracks':
    case 'equalizeTracks': return isIndex(mutation.indexA) && isIndex(mutation.indexB);
    case 'renameTrack': return isIndex(mutation.index) && typeof mutation.name === 'string';
    case 'applyKeymap':
      return isIndex(mutation.trackIndex) && !!mutation.mapping && typeof mutation.mapping === 'object' &&
        Object.entries(mutation.mapping).every(([from, to]) => isIntegerInRange(Number(from), 0, 127) && isIntegerInRange(to, 0, 127));
    default: return false;
  }
}

function isIndex(value: unknown) {
  return isIntegerInRange(value, 0, 4_294_967_295);
}

function isIntegerInRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= maximum;
}
