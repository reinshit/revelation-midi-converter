use std::collections::HashMap;

use midi_to_mml::{BridgeEvent, MmlEvent, MmlSong, MmlSongOptions, utils};
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

const API_VERSION: u32 = 1;

#[derive(Clone, Deserialize, Serialize)]
#[serde(default)]
struct SongOptionsDto {
    auto_boot_velocity: bool,
    auto_equalize_note_length: bool,
    velocity_min: u8,
    velocity_max: u8,
    min_gap_for_chord: u8,
    smallest_unit: usize,
}

#[derive(Deserialize)]
struct KeymapEntryDto {
    from: u8,
    to: u8,
}

impl Default for SongOptionsDto {
    fn default() -> Self {
        Self::from(MmlSongOptions::default())
    }
}

impl From<MmlSongOptions> for SongOptionsDto {
    fn from(options: MmlSongOptions) -> Self {
        Self {
            auto_boot_velocity: options.auto_boot_velocity,
            auto_equalize_note_length: options.auto_equalize_note_length,
            velocity_min: options.velocity_min,
            velocity_max: options.velocity_max,
            min_gap_for_chord: options.min_gap_for_chord,
            smallest_unit: options.smallest_unit,
        }
    }
}

impl SongOptionsDto {
    fn validate(self) -> Result<MmlSongOptions, String> {
        if self.velocity_min > 15 || self.velocity_max > 15 {
            return Err("velocity_min and velocity_max must be between 0 and 15".into());
        }
        if self.velocity_min > self.velocity_max {
            return Err("velocity_min must be less than or equal to velocity_max".into());
        }
        if self.smallest_unit < 2 || !self.smallest_unit.is_power_of_two() {
            return Err("smallest_unit must be a power of two greater than or equal to 2".into());
        }
        Ok(MmlSongOptions {
            auto_boot_velocity: self.auto_boot_velocity,
            auto_equalize_note_length: self.auto_equalize_note_length,
            velocity_min: self.velocity_min,
            velocity_max: self.velocity_max,
            min_gap_for_chord: self.min_gap_for_chord,
            smallest_unit: self.smallest_unit,
        })
    }
}

#[derive(Serialize)]
struct InstrumentSnapshot<'a> {
    name: &'a str,
    program: u8,
    channel: u8,
}

#[derive(Serialize)]
struct TrackSnapshot<'a> {
    index: usize,
    name: &'a str,
    instrument: InstrumentSnapshot<'a>,
    mml: String,
    mml_note_length: usize,
    playback_events: Vec<PlaybackEvent>,
}

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum PlaybackEvent {
    Note {
        key: u8,
        velocity: u8,
        position_units: usize,
        duration_units: usize,
        char_start: usize,
        char_end: usize,
    },
    Tempo {
        bpm: u32,
        position_units: usize,
    },
    Program {
        program: u8,
        channel: u8,
        position_units: usize,
    },
}

#[derive(Serialize)]
struct SongSnapshot<'a> {
    api_version: u32,
    ppq: u16,
    options: SongOptionsDto,
    tracks: Vec<TrackSnapshot<'a>>,
}

#[wasm_bindgen]
pub struct WasmSong {
    inner: MmlSong,
}

#[wasm_bindgen]
impl WasmSong {
    #[wasm_bindgen(constructor)]
    pub fn new(bytes: &[u8], options: JsValue) -> Result<WasmSong, JsValue> {
        let options = decode_options(options)?;
        let inner = MmlSong::from_bytes(bytes.to_vec(), options)
            .map_err(|error| api_error("INVALID_MIDI", error))?;
        Ok(Self { inner })
    }

    pub fn snapshot(&self) -> Result<JsValue, JsValue> {
        let snapshot = SongSnapshot {
            api_version: API_VERSION,
            ppq: self.inner.ppq,
            options: self.inner.options.clone().into(),
            tracks: self
                .inner
                .tracks
                .iter()
                .enumerate()
                .map(|(index, track)| TrackSnapshot {
                    index,
                    name: &track.name,
                    instrument: InstrumentSnapshot {
                        name: &track.instrument.name,
                        program: track.instrument.instrument_id,
                        channel: track.instrument.midi_channel,
                    },
                    mml: track.to_mml(),
                    mml_note_length: track.mml_note_length,
                    playback_events: {
                        let mut char_offset = 0;
                        let mut events = track.events.iter().filter_map(|event| {
                            let char_start = char_offset;
                            char_offset += event.to_mml(track.song_options.smallest_unit).len();
                            match event {
                                MmlEvent::Note(note) => Some(PlaybackEvent::Note {
                                    key: note.midi_state.key,
                                    velocity: note.velocity,
                                    position_units: note.position_in_smallest_unit,
                                    duration_units: note.duration_in_smallest_unit,
                                    char_start,
                                    char_end: char_offset,
                                }),
                                MmlEvent::Tempo(bpm, position_units) => Some(PlaybackEvent::Tempo {
                                    bpm: *bpm,
                                    position_units: *position_units,
                                }),
                                _ => None,
                            }
                        }).collect::<Vec<_>>();
                        events.extend(track.bridge_events.iter().filter_map(|event| match event {
                            BridgeEvent::ProgramChange(instrument, state) => Some(PlaybackEvent::Program {
                                program: instrument.instrument_id,
                                channel: instrument.midi_channel,
                                position_units: utils::tick_to_smallest_unit(
                                    state.position_in_tick,
                                    track.ppq,
                                    track.song_options.smallest_unit,
                                ),
                            }),
                            _ => None,
                        }));
                        events
                    },
                })
                .collect(),
        };
        serde_wasm_bindgen::to_value(&snapshot)
            .map_err(|error| api_error("SERIALIZATION_FAILED", error))
    }

    pub fn update_options(&mut self, options: JsValue) -> Result<JsValue, JsValue> {
        self.inner
            .set_song_options(decode_options(options)?)
            .map_err(|error| api_error("UPDATE_OPTIONS_FAILED", error))?;
        self.snapshot()
    }

    pub fn split_track(&mut self, index: usize) -> Result<JsValue, JsValue> {
        self.inner
            .split_track(index)
            .map_err(|error| api_error("TRACK_NOT_FOUND", error))?;
        self.snapshot()
    }

    pub fn merge_tracks(&mut self, index_a: usize, index_b: usize) -> Result<JsValue, JsValue> {
        if index_a == index_b {
            return Err(api_error("SAME_TRACK", "cannot merge a track with itself"));
        }
        self.inner
            .merge_tracks(index_a, index_b)
            .map_err(|error| api_error("TRACK_NOT_FOUND", error))?;
        self.snapshot()
    }

    pub fn equalize_tracks(&mut self, index_a: usize, index_b: usize) -> Result<JsValue, JsValue> {
        self.inner
            .equalize_tracks(index_a, index_b)
            .map_err(|error| api_error("EQUALIZE_FAILED", error))?;
        self.snapshot()
    }

    pub fn rename_track(&mut self, index: usize, name: String) -> Result<JsValue, JsValue> {
        let track = self
            .inner
            .tracks
            .get_mut(index)
            .ok_or_else(|| {
                api_error("TRACK_NOT_FOUND", format!("track index {index} is out of range"))
            })?;
        track.name = name;
        self.snapshot()
    }

    pub fn apply_keymap(&mut self, track_index: usize, mapping: JsValue) -> Result<JsValue, JsValue> {
        if track_index >= self.inner.tracks.len() {
            return Err(api_error(
                "TRACK_NOT_FOUND",
                format!("track index {track_index} is out of range"),
            ));
        }
        let entries: Vec<KeymapEntryDto> =
            serde_wasm_bindgen::from_value(mapping)
                .map_err(|error| api_error("INVALID_KEYMAP", error))?;
        let mapping: HashMap<u8, u8> = entries
            .into_iter()
            .map(|entry| (entry.from, entry.to))
            .collect();
        self.inner.apply_keymap(track_index, &mapping);
        self.snapshot()
    }
}

fn decode_options(value: JsValue) -> Result<MmlSongOptions, JsValue> {
    if value.is_null() || value.is_undefined() {
        return Ok(MmlSongOptions::default());
    }
    let dto: SongOptionsDto = serde_wasm_bindgen::from_value(value)
        .map_err(|error| api_error("INVALID_OPTIONS", error))?;
    dto.validate()
        .map_err(|error| api_error("INVALID_OPTIONS", error))
}

fn api_error(code: &str, error: impl ToString) -> JsValue {
    let error = js_sys::Error::new(&error.to_string());
    error.set_name("ReveMidiError");
    let _ = js_sys::Reflect::set(
        &error,
        &JsValue::from_str("code"),
        &JsValue::from_str(code),
    );
    error.into()
}
