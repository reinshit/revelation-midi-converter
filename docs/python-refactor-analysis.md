# Analisis Refactor Core MIDI-to-MML ke Python

## Keputusan ruang lingkup

Port pertama sebaiknya hanya mengganti crate `lib` (`midi-to-mml`) dengan package
Python. Flutter GUI, Rinf actor hub, dan `lib_player` tetap di luar port awal.
Ketiganya adalah konsumen dari hasil converter dan dapat dimigrasikan setelah
core Python mencapai behavioral parity.

Target parity adalah perilaku commit `4b04592`, bukan hanya keluaran yang
terlihat benar secara musikal. Setelah parity tercapai, bug kompatibilitas dapat
diperbaiki melalui mode atau versi perilaku terpisah.

## Peta sistem saat ini

```text
MIDI bytes/path
  -> midly::Smf
  -> per-track absolute tick scan
  -> BridgeEvent (Note | Tempo | ProgramChange)
  -> merge global tempo events into every note track
  -> sort: position, then meta/program before note at equal position
  -> raw MmlEvent stream
  -> normalize
  -> repair event positions
  -> normalize again
  -> equalize chord durations
  -> render note durations
  -> MmlTrack.to_mml()
```

The GUI calls the core through `SongActor`. Its effective public operations are:

1. load MIDI using default options;
2. update options and regenerate all tracks;
3. split one track;
4. merge two tracks;
5. equalize two tracks;
6. rename a track;
7. apply a MIDI-key map to one track.

Playback parses generated MML again in `lib_player`; it is useful as an
integration oracle but should not be coupled to the Python converter package.

## Domain contract

### Options

| Field | Python type | Default | Required validation |
|---|---:|---:|---|
| `auto_boot_velocity` | `bool` | `False` | strict bool |
| `auto_equalize_note_length` | `bool` | `False` | strict bool |
| `velocity_min` | `int` | `0` | 0..15 |
| `velocity_max` | `int` | `15` | 0..15; preserve legacy min/max swap |
| `min_gap_for_chord` | `int` | `0` | 0..255 for legacy parity |
| `smallest_unit` | `int` | `64` | positive power of two; at least 2 |

### Core models

Use frozen dataclasses for immutable MIDI/bridge input and mutable dataclasses
for generated song/track/event state:

- `MidiState(position_ticks, duration_ticks, channel)`
- `MidiNoteState(key, velocity, midi_state)`
- `Instrument(name, program, channel)`
- `BridgeNote`, `BridgeTempo`, `BridgeProgramChange`
- `MmlNote`
- `NoteEvent`, `RestEvent`, `TempoEvent`, `OctaveEvent`,
  `OctaveUpEvent`, `OctaveDownEvent`, `ChordEvent`, `VelocityEvent`
- `MmlTrack`
- `MmlSong`

Avoid a single dictionary with a `type` string inside the converter. Typed event
classes make exhaustive dispatch testable and prevent invalid field combinations.
JSON serialization can still use the tagged representation in
`python-port-contract.json`.

### Exact numeric behavior

- MIDI velocity conversion is integer truncation:
  `mml = midi * (max-min) // 127 + min` after swapping reversed bounds.
- One smallest unit in ticks is `ppq / (smallest_unit / 4)`.
- Rust `f32::round()` rounds half away from zero. Python `round()` uses bankers'
  rounding, so it must not be used. For non-negative values use
  `floor(value + 0.5)`.
- The current Rust calculation uses 32-bit floating point. For strict golden
  parity near boundaries, use IEEE-754 float32 semantics (for example
  `struct.pack/unpack`) or replace both implementations with rational arithmetic
  only after golden fixtures document the intended change.
- Tempo is integer BPM: `60_000_000 // microseconds_per_beat`; fractional BPM is
  deliberately discarded.

### Ordering contract

Bridge events sort by absolute tick. At the same tick, tempo/program events sort
before notes. Events within the same category compare equal; do not add a key or
channel tie-breaker during the parity phase. Python sort is stable, which matches
the stable behavior expected by the current pipeline.

## MIDI ingestion behavior

For each physical MIDI track:

- Accumulate delta times into an absolute tick.
- Collect tempo events from every track and copy the combined tempo list into
  every generated MML track.
- Treat `note_on velocity=0` as note-off.
- Close unterminated notes at the last absolute tick in that MIDI track.
- Emit program changes into the same per-track bridge list as notes.
- Use PPQ from metrical timing; the current code silently falls back to 480 for
  non-metrical/SMPTE timing.
- Preserve empty MIDI tracks as empty MML tracks.

Recommended parser dependency: `mido` for a small, pure-Python implementation.
Hide it behind `MidiReader`, so another SMF reader can be substituted without
changing conversion logic. Pin the dependency version in `pyproject.toml`.

## MML generation behavior

1. Convert pitch by `key % 12` using flat spellings: `c, c-, d, d-, e, f, f-,
   g, g-, a, a-, b`; rest is `r`.
2. Convert octave as `0` for keys below 12, otherwise `key // 12 - 1`.
3. Quantize absolute position and duration separately.
4. First note emits any leading rest, then velocity and octave.
5. Later notes emit octave transition (`>`, `<`, or `oN`) and velocity only when
   changed.
6. Positive gaps become rests. Overlap with onset difference at or below
   `min_gap_for_chord` becomes `:`. Other overlap shortens the first onset note.
7. Repair each non-chord note and tempo event so its computed sequential position
   equals its quantized absolute position.
8. Make every chord member use the first note's duration.
9. Render duration greedily using powers of two, one optional dot, and `&` ties.
10. Concatenate without whitespace.

Examples fixed by current tests:

- 16 units at smallest-unit 64 -> `c4`
- 24 -> `c4.`
- 20 -> `c4&c16`
- 56 -> `c2.&c8`
- 128 -> `c1.&c2`

## Proposed Python package

```text
python/
  pyproject.toml
  src/reve_midi_mml/
    __init__.py          # stable public API only
    options.py           # validated MmlSongOptions
    models.py            # MIDI, bridge, instrument, MML dataclasses
    midi_reader.py       # SMF adapter and absolute-time extraction
    bridge.py            # MIDI messages -> BridgeEvent
    quantize.py          # tick, velocity, pitch, octave conversion
    transform.py         # normalize, position repair, chord rules
    render.py            # duration decomposition and MML serialization
    track.py             # split, merge, keymap, regeneration
    song.py              # load, options, cross-track operations
    api.py               # JSON-safe facade for Flutter/CLI
  tests/
    unit/
    parity/
    fixtures/
```

Do not reproduce Rayon-style parallelism initially. Conversion is deterministic
and mostly linear; multiprocessing would add serialization overhead and ordering
risk. Profile representative large files after parity.

## API proposed for the first port

```python
song = MmlSong.from_path(path, options=MmlSongOptions())
song = MmlSong.from_bytes(data, options=MmlSongOptions())
track.to_mml() -> str
song.set_options(options) -> None
song.split_track(index) -> None
song.merge_tracks(index_a, index_b) -> None
song.equalize_tracks(index_a, index_b) -> None
song.apply_keymap(track_index, mapping) -> None
song.to_dict() -> dict
```

`to_dict()` should match the GUI-visible fields: options, track index/name,
instrument name/program/channel, MML string, and MML note length.

## Compatibility bugs and decisions

These behaviors exist in the Rust baseline and must be explicitly marked
`preserve` or `fix` before production cutover:

| ID | Current behavior | Recommended policy |
|---|---|---|
| B01 | Active notes are keyed only by MIDI key, not `(channel,key)` | Fix in v2; preserve in strict legacy mode |
| B02 | Repeated overlapping note-on for the same key overwrites the earlier note | Fix with a per-key queue/stack in v2 |
| B03 | SMPTE timing silently becomes PPQ 480 | Raise `UnsupportedTimingError` in v2 |
| B04 | Program changes from multiple channels collapse to the last encountered instrument for track metadata | Preserve output initially; expose per-event program data later |
| B05 | `min_gap_for_chord` units are inconsistent: conversion compares smallest units, split multiplies by `smallest_unit` but compares ticks | Add regression fixture, then define one canonical unit |
| B06 | `apply_keymap` updates pitch/octave on note objects but does not regenerate octave control events | Fix only behind a behavior-version change |
| B07 | `set_song_options` can boost already regenerated events; repeated calls need parity tests | Golden-test repeated option changes |
| B08 | `merge_tracks(index_a,index_b)` removal can invalidate assumptions when indices coincide or order differs | Validate distinct indices and test both orders |
| B09 | GUI `u32 -> u8` casts silently wrap values | Validate at Python API boundary |
| B10 | `smallest_unit` zero/non-power-of-two can divide by zero or render invalid durations | Reject during option construction |

## Test and data strategy

### Golden fixture format

For each MIDI and option set, store:

- source SHA-256;
- behavior version;
- parser/library version;
- PPQ and track count;
- ordered bridge events;
- ordered final MML events;
- final MML per track;
- instrument metadata and `mml_note_length`;
- invariants and known legacy-bug flags.

The machine-readable inventory and event schema are in
`python-port-contract.json`. Actual golden outputs must be exported by the Rust
implementation before replacing it. Add a small Rust example named
`export_parity_fixtures` rather than scraping debug output.

### Required parity matrix

- Seven repository MIDI fixtures with default options.
- `smallest_unit`: 16, 32, 64, 128.
- velocity ranges: 0..15, 5..10, reversed 10..5, equal 7..7.
- `min_gap_for_chord`: 0, 1, and a boundary overlap case.
- auto velocity boost on/off and repeated option updates.
- notes at quantization boundaries including exact `.5` units.
- one/many tempo changes, tempo at same tick as note, and duplicate tempos.
- empty track, missing note-off, note-off without note-on, velocity-zero note-off.
- multi-channel same key and repeated overlapping same key.
- split, merge in both index orders, equalize, rename, and keymap across octave.

### Invariants

- Every non-chord note's stored position equals its computed sequential position.
- Every tempo's stored position equals its computed sequential position.
- Rests and standalone notes have positive duration after normalization.
- A chord note has a preceding chord connector and the first onset duration.
- Adjacent tempo events do not survive normalization.
- Rendering contains no whitespace.
- Re-running generation from unchanged bridge data is idempotent.
- Parsing the final MML with `lib_player` succeeds during the transition period.

## Migration sequence

1. Add a Rust JSON fixture exporter and freeze baseline outputs.
2. Scaffold the Python package and port pure quantization/render functions.
3. Port typed models and bridge ordering.
4. Port MIDI ingestion and compare bridge JSON.
5. Port transform pipeline and compare event JSON after every phase.
6. Port track/song mutations and all GUI-visible response shapes.
7. Add a CLI or process boundary for Flutter integration; do not embed Python in
   mobile builds without validating packaging constraints.
8. Run dual conversion in development and diff results.
9. Choose/fix compatibility bugs under a versioned behavior flag.
10. Cut over only when every golden fixture and invariant passes.

## Platform warning

The current product targets Android, iOS, Windows, Linux, macOS, and web through
Flutter/Rust. A Python core is straightforward for a desktop CLI/service, but
shipping an embedded Python runtime on all those targets—especially iOS and
web—is a separate architectural project. If cross-platform mobile/web support
must remain, keep Rust as the shipped engine and use Python as the reference
implementation/tooling, or expose Python as a remote/local service only where
deployment permits it.

## Local verification status

Static analysis was completed against commit `4b04592`. Runtime verification is
currently blocked because `cargo` is not available and Windows Python Manager
cannot find a local Python runtime in this environment. No test result is
therefore claimed by this document.
