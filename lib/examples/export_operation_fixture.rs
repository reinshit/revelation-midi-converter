use std::{collections::HashMap, env, fs, path::PathBuf};

use anyhow::{Context, Result};
use midi_to_mml::{MmlEvent, MmlSong, MmlSongOptions};
use serde_json::{Value, json};

fn main() -> Result<()> {
    let repository_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .context("lib crate must be inside repository root")?
        .to_path_buf();
    let source_path = repository_root.join("assets/test.mid");
    let bytes = fs::read(&source_path)?;

    let mut cases = Vec::new();

    let options = MmlSongOptions {
        auto_boot_velocity: true,
        auto_equalize_note_length: true,
        velocity_min: 5,
        velocity_max: 10,
        min_gap_for_chord: 1,
        smallest_unit: 32,
    };
    let mut song = fresh_song(&bytes)?;
    song.set_song_options(options)?;
    cases.push(case("update_options", snapshot(&song)));

    let mut song = fresh_song(&bytes)?;
    song.split_track(0)?;
    cases.push(case("split_track_0", snapshot(&song)));

    let mut song = fresh_song(&bytes)?;
    song.merge_tracks(0, 1)?;
    cases.push(case("merge_tracks_0_1", snapshot(&song)));

    let mut song = fresh_song(&bytes)?;
    song.equalize_tracks(0, 1)?;
    cases.push(case("equalize_tracks_0_1", snapshot(&song)));

    let mut song = fresh_song(&bytes)?;
    song.tracks[0].name = "Lead melody".into();
    cases.push(case("rename_track_0", snapshot(&song)));

    let mut song = fresh_song(&bytes)?;
    song.apply_keymap(0, &HashMap::from([(62, 74), (65, 77)]));
    cases.push(case("apply_keymap_track_0", snapshot(&song)));

    let output = json!({
        "schema_version": 1,
        "behavior_version": "rust-0.2.0-legacy",
        "source": "test.mid",
        "cases": cases,
    });
    let output_path = repository_root.join("fixtures/parity/operations.json");
    serde_json::to_writer_pretty(fs::File::create(&output_path)?, &output)?;
    println!("Exported {}", output_path.display());
    Ok(())
}

fn fresh_song(bytes: &[u8]) -> Result<MmlSong> {
    MmlSong::from_bytes(bytes.to_vec(), MmlSongOptions::default())
}

fn case(name: &str, result: Value) -> Value {
    json!({ "name": name, "result": result })
}

fn snapshot(song: &MmlSong) -> Value {
    json!({
        "api_version": 1,
        "ppq": song.ppq,
        "options": {
            "auto_boot_velocity": song.options.auto_boot_velocity,
            "auto_equalize_note_length": song.options.auto_equalize_note_length,
            "velocity_min": song.options.velocity_min,
            "velocity_max": song.options.velocity_max,
            "min_gap_for_chord": song.options.min_gap_for_chord,
            "smallest_unit": song.options.smallest_unit,
        },
        "tracks": song.tracks.iter().enumerate().map(|(index, track)| {
            let playback_events = track.events.iter().filter_map(|event| {
                    match event {
                        MmlEvent::Note(note) => Some(json!({
                            "type": "note",
                            "key": note.midi_state.key,
                            "velocity": note.velocity,
                            "position_units": note.position_in_smallest_unit,
                            "duration_units": note.duration_in_smallest_unit,
                        })),
                        MmlEvent::Tempo(bpm, position_units) => Some(json!({
                            "type": "tempo",
                            "bpm": bpm,
                            "position_units": position_units,
                        })),
                        _ => None,
                    }
                }).collect::<Vec<_>>();
            json!({
                "index": index,
                "name": track.name,
                "instrument": {
                    "name": track.instrument.name,
                    "program": track.instrument.instrument_id,
                    "channel": track.instrument.midi_channel,
                },
                "mml": track.to_mml(),
                "mml_note_length": track.mml_note_length,
                "playback_events": playback_events,
            })
        }).collect::<Vec<_>>()
    })
}
