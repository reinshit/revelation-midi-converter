import assert from 'node:assert/strict';
import { parseProject, serializeProject } from '../web/lib/storage/project.ts';

const options = {
  auto_boot_velocity: false,
  auto_equalize_note_length: true,
  velocity_min: 2,
  velocity_max: 14,
  min_gap_for_chord: 3,
  smallest_unit: 64,
};
const source = Uint8Array.from([0x4d, 0x54, 0x68, 0x64, 0, 1, 2, 3]).buffer;
const mutations = [
  { type: 'renameTrack', index: 0, name: 'Lead' },
  { type: 'applyKeymap', trackIndex: 0, mapping: { 60: 72 } },
];

const restored = parseProject(serializeProject('fixture.mid', { sourceBytes: source, initialOptions: options, mutations }));
assert.equal(restored.name, 'fixture.mid');
assert.deepEqual(new Uint8Array(restored.sourceBytes), new Uint8Array(source));
assert.deepEqual(restored.initialOptions, options);
assert.deepEqual(restored.mutations, mutations);

assert.throws(() => parseProject('{'), /not valid JSON/);
assert.throws(() => parseProject('{"schema_version":2}'), /Unsupported project schema version: 2/);
assert.throws(
  () => parseProject(serializeProject('fixture.mid', { sourceBytes: source, initialOptions: { ...options, velocity_max: 99 }, mutations })),
  /invalid or unsupported/,
);
assert.throws(
  () => parseProject(JSON.stringify({ schema_version: 1, source: { name: 'x.mid', bytes_base64: '***' }, initial_options: options, mutations: [] })),
  /MIDI data.*corrupted/,
);

console.log('Project format verified: round-trip plus malformed schema, options, JSON, and MIDI payload.');
