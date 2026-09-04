use std::{
    env, fs,
    path::{Path, PathBuf},
};

use anyhow::{Context, Result, bail};
use midi_to_mml::{BridgeEvent, MmlEvent, MmlSong, MmlSongOptions};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

const BEHAVIOR_VERSION: &str = "rust-0.2.0-legacy";

fn main() -> Result<()> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let repository_root = manifest_dir
        .parent()
        .context("lib crate must be inside the repository root")?;
    let output_dir = repository_root.join("fixtures").join("parity");
    fs::create_dir_all(&output_dir)
        .with_context(|| format!("cannot create {}", output_dir.display()))?;

    let inputs = collect_inputs(repository_root)?;
    if inputs.is_empty() {
        bail!("no MIDI fixtures found");
    }

    for input in inputs {
        export_fixture(&input, &output_dir)?;
    }

    println!("Exported parity fixtures to {}", output_dir.display());
    Ok(())
}

fn collect_inputs(repository_root: &Path) -> Result<Vec<PathBuf>> {
    let args: Vec<PathBuf> = env::args_os().skip(1).map(PathBuf::from).collect();
    if !args.is_empty() {
        return Ok(args);
    }

    let assets_dir = repository_root.join("assets");
    let mut inputs = fs::read_dir(&assets_dir)
        .with_context(|| format!("cannot read {}", assets_dir.display()))?
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| {
            path.extension()
                .is_some_and(|extension| extension.to_string_lossy().eq_ignore_ascii_case("mid"))
        })
        .collect::<Vec<_>>();
    inputs.sort();
    Ok(inputs)
}

fn export_fixture(input: &Path, output_dir: &Path) -> Result<()> {
    let bytes = fs::read(input).with_context(|| format!("cannot read {}", input.display()))?;
    let options = MmlSongOptions::default();
    let song = MmlSong::from_bytes(bytes.clone(), options.clone())
        .with_context(|| format!("cannot convert {}", input.display()))?;

    let source_name = input
        .file_name()
        .context("MIDI input has no file name")?
        .to_string_lossy();
    let fixture_name = input
        .file_stem()
        .context("MIDI input has no file stem")?
        .to_string_lossy();

    let tracks = song
        .tracks
        .iter()
        .enumerate()
        .map(|(index, track)| {
            json!({
                "index": index,
                "name": track.name,
                "instrument": {
                    "name": track.instrument.name,
                    "program": track.instrument.instrument_id,
                    "channel": track.instrument.midi_channel
                },
                "mml_note_length": track.mml_note_length,
                "mml": track.to_mml(),
                "bridge_events": track.bridge_events.iter().map(bridge_event_json).collect::<Vec<_>>(),
                "mml_events": track.events.iter().map(mml_event_json).collect::<Vec<_>>()
            })
        })
        .collect::<Vec<_>>();

    let fixture = json!({
        "schema_version": 1,
        "behavior_version": BEHAVIOR_VERSION,
        "source": {
            "file": source_name,
            "bytes": bytes.len(),
            "sha256": format!("{:x}", Sha256::digest(&bytes))
        },
        "options": options_json(&options),
        "ppq": song.ppq,
        "track_count": song.tracks.len(),
        "tracks": tracks
    });

    let output_path = output_dir.join(format!("{fixture_name}.default.json"));
    let output_file = fs::File::create(&output_path)
        .with_context(|| format!("cannot create {}", output_path.display()))?;
    serde_json::to_writer_pretty(output_file, &fixture)
        .with_context(|| format!("cannot serialize {}", output_path.display()))?;
    println!("{} -> {}", input.display(), output_path.display());
    Ok(())
}

fn options_json(options: &MmlSongOptions) -> Value {
    json!({
        "auto_boot_velocity": options.auto_boot_velocity,
        "auto_equalize_note_length": options.auto_equalize_note_length,
        "velocity_min": options.velocity_min,
        "velocity_max": options.velocity_max,
        "min_gap_for_chord": options.min_gap_for_chord,
        "smallest_unit": options.smallest_unit
    })
}

fn bridge_event_json(event: &BridgeEvent) -> Value {
    match event {
        BridgeEvent::Note(note) => json!({
            "type": "note",
            "key": note.key,
            "velocity": note.velocity,
            "position_ticks": note.midi_state.position_in_tick,
            "duration_ticks": note.midi_state.duration_in_tick,
            "channel": note.midi_state.channel
        }),
        BridgeEvent::Tempo(bpm, state) => json!({
            "type": "tempo",
            "bpm": bpm,
            "position_ticks": state.position_in_tick
        }),
        BridgeEvent::ProgramChange(instrument, state) => json!({
            "type": "program_change",
            "program": instrument.instrument_id,
            "channel": instrument.midi_channel,
            "instrument_name": instrument.name,
            "position_ticks": state.position_in_tick
        }),
    }
}

fn mml_event_json(event: &MmlEvent) -> Value {
    match event {
        MmlEvent::Note(note) => json!({
            "type": "note",
            "key": note.midi_state.key,
            "pitch": note.pitch_class.to_string(),
            "octave": note.octave,
            "velocity": note.velocity,
            "position_units": note.position_in_smallest_unit,
            "duration_units": note.duration_in_smallest_unit,
            "is_chord_member": note.is_part_of_chord,
            "mml": note.mml_string,
            "mml_note_length": note.mml_note_length
        }),
        MmlEvent::Rest(duration) => json!({
            "type": "rest",
            "duration_units": duration
        }),
        MmlEvent::Tempo(bpm, position) => json!({
            "type": "tempo",
            "bpm": bpm,
            "position_units": position
        }),
        MmlEvent::Octave(value) => json!({"type": "octave", "value": value}),
        MmlEvent::IncreOctave => json!({"type": "octave_up"}),
        MmlEvent::DecreOctave => json!({"type": "octave_down"}),
        MmlEvent::ConnectChord => json!({"type": "chord"}),
        MmlEvent::Velocity(value) => json!({"type": "velocity", "value": value}),
        MmlEvent::NoteLength(value) => json!({"type": "note_length", "value": value}),
    }
}
