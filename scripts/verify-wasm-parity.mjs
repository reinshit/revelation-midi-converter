import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import initWasm, { WasmSong } from '../web/lib/wasm/pkg/reve_midi_wasm.js';

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.dirname(scriptsDirectory);
const packageDirectory = path.join(repositoryRoot, 'web', 'lib', 'wasm', 'pkg');
const fixtureDirectory = path.join(repositoryRoot, 'fixtures', 'parity');

await initWasm({
  module_or_path: await readFile(path.join(packageDirectory, 'reve_midi_wasm_bg.wasm')),
});

const fixtureNames = (await readdir(fixtureDirectory))
  .filter((name) => name.endsWith('.default.json'))
  .sort();

assert.equal(fixtureNames.length, 1, 'expected one default parity fixture');

let verifiedTracks = 0;
let verifiedProgramChanges = 0;

for (const fixtureName of fixtureNames) {
  const fixture = JSON.parse(
    await readFile(path.join(fixtureDirectory, fixtureName), 'utf8'),
  );
  const midi = await readFile(path.join(repositoryRoot, 'assets', fixture.source.file));
  const song = new WasmSong(midi, fixture.options);

  try {
    const snapshot = song.snapshot();
    assert.equal(snapshot.api_version, 1, `${fixtureName}: API version`);
    assert.equal(snapshot.ppq, fixture.ppq, `${fixtureName}: PPQ`);
    assert.deepEqual(snapshot.options, fixture.options, `${fixtureName}: options`);
    assert.equal(snapshot.tracks.length, fixture.tracks.length, `${fixtureName}: tracks`);

    verifyCharacterRanges(snapshot, fixtureName);
    verifiedProgramChanges += snapshot.tracks.flatMap((track) => track.playback_events).filter((event) => event.type === 'program').length;

    for (let index = 0; index < fixture.tracks.length; index += 1) {
      const actual = snapshot.tracks[index];
      const expected = fixture.tracks[index];
      const context = `${fixtureName} track ${index}`;

      assert.equal(actual.index, expected.index, `${context}: index`);
      assert.equal(actual.name, expected.name, `${context}: name`);
      assert.deepEqual(actual.instrument, expected.instrument, `${context}: instrument`);
      assert.equal(actual.mml_note_length, expected.mml_note_length, `${context}: note length`);
      assert.equal(actual.mml, expected.mml, `${context}: MML`);
      verifiedTracks += 1;
    }
  } finally {
    song.free();
  }
}

const operations = JSON.parse(
  await readFile(path.join(fixtureDirectory, 'operations.json'), 'utf8'),
);
const operationMidi = await readFile(
  path.join(repositoryRoot, 'assets', operations.source),
);

const defaultOptions = {
  auto_boot_velocity: false,
  auto_equalize_note_length: false,
  velocity_min: 0,
  velocity_max: 15,
  min_gap_for_chord: 0,
  smallest_unit: 64,
};
const optionMatrix = [
  { ...defaultOptions, smallest_unit: 16 },
  { ...defaultOptions, velocity_min: 3, velocity_max: 12 },
  { ...defaultOptions, min_gap_for_chord: 8 },
  { ...defaultOptions, auto_boot_velocity: true },
  { ...defaultOptions, auto_equalize_note_length: true },
];

for (const options of optionMatrix) {
  const first = new WasmSong(operationMidi, options);
  const second = new WasmSong(operationMidi, options);
  try {
    const firstSnapshot = first.snapshot();
    const secondSnapshot = second.snapshot();
    assert.deepEqual(firstSnapshot.options, options, 'non-default options must survive the WASM boundary');
    assert.deepEqual(firstSnapshot, secondSnapshot, 'non-default conversion must be deterministic');
    verifyCharacterRanges(firstSnapshot, `option matrix ${JSON.stringify(options)}`);
  } finally {
    first.free();
    second.free();
  }
}

{
  const repeated = new WasmSong(operationMidi, undefined);
  const fresh = new WasmSong(operationMidi, optionMatrix[1]);
  try {
    repeated.update_options(optionMatrix[0]);
    const repeatedResult = repeated.update_options(optionMatrix[1]);
    assert.deepEqual(repeatedResult, fresh.snapshot(), 'repeated option updates must match a fresh conversion');
  } finally {
    repeated.free();
    fresh.free();
  }
}

for (const operation of operations.cases) {
  const song = new WasmSong(operationMidi, undefined);
  try {
    let actual;
    switch (operation.name) {
      case 'update_options':
        actual = song.update_options({
          auto_boot_velocity: true,
          auto_equalize_note_length: true,
          velocity_min: 5,
          velocity_max: 10,
          min_gap_for_chord: 1,
          smallest_unit: 32,
        });
        break;
      case 'split_track_0':
        actual = song.split_track(0);
        break;
      case 'merge_tracks_0_1':
        actual = song.merge_tracks(0, 1);
        break;
      case 'equalize_tracks_0_1':
        actual = song.equalize_tracks(0, 1);
        break;
      case 'rename_track_0':
        actual = song.rename_track(0, 'Lead melody');
        break;
      case 'apply_keymap_track_0':
        actual = song.apply_keymap(0, [
          { from: 62, to: 74 },
          { from: 65, to: 77 },
        ]);
        break;
      default:
        throw new Error(`unknown operation fixture: ${operation.name}`);
    }
    assert.deepEqual(withoutCharacterRanges(actual), operation.result, `${operation.name}: native/WASM parity`);
  } finally {
    song.free();
  }
}

expectErrorCode(
  () => new WasmSong(operationMidi, { smallest_unit: 3 }),
  'INVALID_OPTIONS',
);
expectErrorCode(
  () => new WasmSong(operationMidi, { ...defaultOptions, velocity_min: 12, velocity_max: 3 }),
  'INVALID_OPTIONS',
);
expectErrorCode(() => new WasmSong(Uint8Array.from([1, 2, 3]), undefined), 'INVALID_MIDI');
assert.ok(verifiedProgramChanges > 0, 'expected source fixtures to preserve program changes');

{
  const song = new WasmSong(operationMidi, undefined);
  try {
    expectErrorCode(() => song.merge_tracks(0, 0), 'SAME_TRACK');
    expectErrorCode(() => song.rename_track(99, 'missing'), 'TRACK_NOT_FOUND');
  } finally {
    song.free();
  }
}

console.log(
  `WASM parity verified: ${fixtureNames.length} files, ${verifiedTracks} tracks, ${operations.cases.length} operations, ${optionMatrix.length} non-default option cases, ${verifiedProgramChanges} program changes.`,
);

function expectErrorCode(callback, code) {
  try {
    callback();
    assert.fail(`expected error code ${code}`);
  } catch (error) {
    assert.equal(error?.name, 'ReveMidiError', `${code}: error name`);
    assert.equal(error?.code, code, `${code}: error code`);
  }
}

function verifyCharacterRanges(snapshot, context) {
  for (const track of snapshot.tracks) {
    let previousEnd = 0;
    for (const event of track.playback_events) {
      if (event.type !== 'note') continue;
      assert.ok(Number.isInteger(event.char_start), `${context}: char_start must be an integer`);
      assert.ok(Number.isInteger(event.char_end), `${context}: char_end must be an integer`);
      assert.ok(event.char_start >= previousEnd, `${context}: note ranges must be ordered`);
      assert.ok(event.char_end > event.char_start, `${context}: note range must not be empty`);
      assert.ok(event.char_end <= track.mml.length, `${context}: note range exceeds MML`);
      assert.match(track.mml.slice(event.char_start, event.char_end), /^[a-g]/, `${context}: note range does not point to MML note text`);
      previousEnd = event.char_end;
    }
  }
}

function withoutCharacterRanges(snapshot) {
  return {
    ...snapshot,
    tracks: snapshot.tracks.map((track) => ({
      ...track,
      playback_events: track.playback_events.filter((event) => event.type !== 'program').map((event) => {
        if (event.type !== 'note') return event;
        const { char_start: _charStart, char_end: _charEnd, ...legacyEvent } = event;
        return legacyEvent;
      }),
    })),
  };
}
