# MIDI-to-MML parity fixtures

These files capture the observable converter state for the seven repository MIDI
assets using `MmlSongOptions::default()` at source commit `4b04592`.

Regenerate them from the repository root with:

```powershell
cargo run -p midi-to-mml --example export_parity_fixtures
```

Verify the committed fixtures and their source MIDI files without regenerating
them:

```powershell
./scripts/verify-parity-fixtures.ps1
```

The verifier checks inventory completeness, MIDI byte lengths and SHA-256,
schema metadata, bridge ordering, normalized event positions, chord structure,
positive durations, rendered note counts, and whitespace-free MML. Regeneration
and verification are intentionally separate: a converter regression must not be
able to bless its own changed output in the same command.

Each JSON document contains the source SHA-256, options, PPQ, ordered bridge
events, ordered final MML events, instrument metadata, note count, and final MML
for every track. A refactor must match these fixtures before intentional behavior
changes are accepted.

The exporter also accepts one or more explicit MIDI paths. Default export files
are intentionally verbose: phase-by-phase differences are easier to diagnose than
differences in final MML strings alone.
