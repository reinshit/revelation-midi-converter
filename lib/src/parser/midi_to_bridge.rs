use crate::{
    Instrument,
    mml_event::{BridgeEvent, MidiNoteState, MidiState},
};
use midly::{MetaMessage, MidiMessage, Track as MidiTrack, TrackEventKind};
use std::collections::{HashMap, VecDeque};

type HeldNotes = HashMap<(u8, u8), VecDeque<MidiNoteState>>;

pub fn bridge_meta_from_midi_track(midi_track: &MidiTrack) -> Vec<BridgeEvent> {
    let mut meta_events: Vec<BridgeEvent> = Vec::new();
    let mut current_ticks = 0usize;

    for midi_event in midi_track.iter() {
        let delta = midi_event.delta.as_int() as usize;
        current_ticks += delta;

        if let TrackEventKind::Meta(message) = midi_event.kind
            && let MetaMessage::Tempo(tempo) = message
        {
            let tempo = 60_000_000 / tempo.as_int();

            meta_events.push(BridgeEvent::Tempo(
                tempo,
                MidiState {
                    position_in_tick: current_ticks,
                    duration_in_tick: 0,
                    channel: 0,
                },
            ));
        }
    }

    meta_events
}

pub fn bridge_notes_from_midi_track(midi_track: &MidiTrack) -> Vec<BridgeEvent> {
    let mut note_events: Vec<BridgeEvent> = Vec::new();
    let mut holding_notes: HeldNotes = HashMap::new();
    let mut current_ticks = 0usize;

    for midi_event in midi_track.iter() {
        let delta = midi_event.delta.as_int() as usize;
        current_ticks += delta;

        if let TrackEventKind::Midi { channel, message } = midi_event.kind {
            let channel = channel.as_int();

            match message {
                MidiMessage::ProgramChange { program } => {
                    let instrument = Instrument::new(program.as_int(), channel);

                    note_events.push(BridgeEvent::ProgramChange(
                        instrument,
                        MidiState {
                            position_in_tick: current_ticks,
                            duration_in_tick: 0,
                            channel,
                        },
                    ));
                }

                MidiMessage::NoteOn { key, vel } => {
                    let key = key.as_int();
                    let vel = vel.as_int();

                    if vel > 0 {
                        insert_note(&mut holding_notes, channel, key, vel, current_ticks);
                    } else {
                        update_note(
                            &mut holding_notes,
                            &mut note_events,
                            channel,
                            key,
                            current_ticks,
                        );
                    }
                }
                MidiMessage::NoteOff { key, .. } => {
                    let key = key.as_int();

                    update_note(
                        &mut holding_notes,
                        &mut note_events,
                        channel,
                        key,
                        current_ticks,
                    );
                }
                _ => (),
            }
        }
    }

    for notes in holding_notes.into_values() {
        for mut note in notes {
            let duration = current_ticks - note.midi_state.position_in_tick;
            note.midi_state.duration_in_tick = duration;
            note_events.push(BridgeEvent::Note(note));
        }
    }

    note_events
}

fn insert_note(
    holding_notes: &mut HeldNotes,
    channel: u8,
    key: u8,
    velocity: u8,
    position_in_tick: usize,
) {
    holding_notes
        .entry((channel, key))
        .or_default()
        .push_back(MidiNoteState {
            key,
            velocity,
            midi_state: MidiState {
                channel,
                position_in_tick,
                duration_in_tick: 0,
            },
        });
}

fn update_note(
    holding_notes: &mut HeldNotes,
    events: &mut Vec<BridgeEvent>,
    channel: u8,
    key: u8,
    position_in_tick: usize,
) {
    let note_key = (channel, key);
    if let Some(notes) = holding_notes.get_mut(&note_key)
        && let Some(mut note) = notes.pop_front()
    {
        let duration = position_in_tick - note.midi_state.position_in_tick;

        note.midi_state.duration_in_tick = duration;
        events.push(BridgeEvent::Note(note));

        if notes.is_empty() {
            holding_notes.remove(&note_key);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use midly::{MetaMessage, MidiMessage, TrackEvent, TrackEventKind};

    fn create_midi_event(delta: u32, kind: TrackEventKind) -> TrackEvent {
        TrackEvent {
            delta: delta.into(),
            kind,
        }
    }

    #[test]
    fn test_bridge_meta_from_midi_track_tempo() {
        let tempo_event = create_midi_event(
            0,
            TrackEventKind::Meta(MetaMessage::Tempo(500000.into())), // 120 BPM
        );

        let tempo_event2 = create_midi_event(
            480,
            TrackEventKind::Meta(MetaMessage::Tempo(400000.into())), // 150 BPM
        );

        let track = vec![tempo_event, tempo_event2];
        let meta_events = bridge_meta_from_midi_track(&track);

        assert_eq!(meta_events.len(), 2);

        match &meta_events[0] {
            BridgeEvent::Tempo(tempo, state) => {
                assert_eq!(*tempo, 120); // 60_000_000 / 500_000 = 120
                assert_eq!(state.position_in_tick, 0);
            }
            _ => panic!("Expected tempo event"),
        }

        match &meta_events[1] {
            BridgeEvent::Tempo(tempo, state) => {
                assert_eq!(*tempo, 150); // 60_000_000 / 400_000 = 150
                assert_eq!(state.position_in_tick, 480);
            }
            _ => panic!("Expected tempo event"),
        }
    }

    #[test]
    fn test_bridge_meta_from_midi_track_no_tempo() {
        // Track with no tempo events
        let note_on = create_midi_event(
            0,
            TrackEventKind::Midi {
                channel: 0.into(),
                message: MidiMessage::NoteOn {
                    key: 60.into(),
                    vel: 64.into(),
                },
            },
        );

        let track = vec![note_on];
        let meta_events = bridge_meta_from_midi_track(&track);

        assert_eq!(meta_events.len(), 0);
    }

    #[test]
    fn test_bridge_notes_from_midi_track_single_note() {
        let note_on = create_midi_event(
            0,
            TrackEventKind::Midi {
                channel: 0.into(),
                message: MidiMessage::NoteOn {
                    key: 60.into(),
                    vel: 64.into(),
                },
            },
        );

        let note_off = create_midi_event(
            480, // Quarter note duration
            TrackEventKind::Midi {
                channel: 0.into(),
                message: MidiMessage::NoteOff {
                    key: 60.into(),
                    vel: 64.into(),
                },
            },
        );

        let track = vec![note_on, note_off];
        let note_events = bridge_notes_from_midi_track(&track);

        assert_eq!(note_events.len(), 1);

        match &note_events[0] {
            BridgeEvent::Note(note_state) => {
                assert_eq!(note_state.key, 60);
                assert_eq!(note_state.velocity, 64);
                assert_eq!(note_state.midi_state.position_in_tick, 0);
                assert_eq!(note_state.midi_state.duration_in_tick, 480);
                assert_eq!(note_state.midi_state.channel, 0);
            }
            _ => panic!("Expected note event"),
        }
    }

    #[test]
    fn test_bridge_notes_from_midi_track_note_on_zero_velocity() {
        // Note on with zero velocity should be treated as note off
        let note_on_normal = create_midi_event(
            0,
            TrackEventKind::Midi {
                channel: 0.into(),
                message: MidiMessage::NoteOn {
                    key: 60.into(),
                    vel: 64.into(),
                },
            },
        );

        let note_on_zero_vel = create_midi_event(
            480,
            TrackEventKind::Midi {
                channel: 0.into(),
                message: MidiMessage::NoteOn {
                    key: 60.into(),
                    vel: 0.into(),
                },
            },
        );

        let track = vec![note_on_normal, note_on_zero_vel];
        let note_events = bridge_notes_from_midi_track(&track);

        assert_eq!(note_events.len(), 1);

        match &note_events[0] {
            BridgeEvent::Note(note_state) => {
                assert_eq!(note_state.midi_state.duration_in_tick, 480);
            }
            _ => panic!("Expected note event"),
        }
    }

    #[test]
    fn test_bridge_notes_from_midi_track_program_change() {
        let program_change = create_midi_event(
            0,
            TrackEventKind::Midi {
                channel: 0.into(),
                message: MidiMessage::ProgramChange {
                    program: 1.into(), // Bright acoustic piano
                },
            },
        );

        let track = vec![program_change];
        let note_events = bridge_notes_from_midi_track(&track);

        assert_eq!(note_events.len(), 1);

        match &note_events[0] {
            BridgeEvent::ProgramChange(instrument, state) => {
                assert_eq!(instrument.instrument_id, 1);
                assert_eq!(instrument.midi_channel, 0);
                assert_eq!(state.position_in_tick, 0);
            }
            _ => panic!("Expected program change event"),
        }
    }

    #[test]
    fn test_bridge_notes_multiple_channels() {
        let note_on_ch0 = create_midi_event(
            0,
            TrackEventKind::Midi {
                channel: 0.into(),
                message: MidiMessage::NoteOn {
                    key: 60.into(),
                    vel: 64.into(),
                },
            },
        );

        let note_on_ch1 = create_midi_event(
            0,
            TrackEventKind::Midi {
                channel: 1.into(),
                message: MidiMessage::NoteOn {
                    key: 60.into(),
                    vel: 80.into(),
                },
            },
        );

        let note_off_ch0 = create_midi_event(
            480,
            TrackEventKind::Midi {
                channel: 0.into(),
                message: MidiMessage::NoteOff {
                    key: 60.into(),
                    vel: 0.into(),
                },
            },
        );

        let note_off_ch1 = create_midi_event(
            0,
            TrackEventKind::Midi {
                channel: 1.into(),
                message: MidiMessage::NoteOff {
                    key: 60.into(),
                    vel: 0.into(),
                },
            },
        );

        let track = vec![note_on_ch0, note_on_ch1, note_off_ch0, note_off_ch1];
        let note_events = bridge_notes_from_midi_track(&track);

        assert_eq!(note_events.len(), 2);

        // Verify both notes are captured with correct channels
        let mut found_ch0 = false;
        let mut found_ch1 = false;

        for event in &note_events {
            if let BridgeEvent::Note(note_state) = event {
                match note_state.midi_state.channel {
                    0 => {
                        assert_eq!(note_state.key, 60);
                        assert_eq!(note_state.velocity, 64);
                        found_ch0 = true;
                    }
                    1 => {
                        assert_eq!(note_state.key, 60);
                        assert_eq!(note_state.velocity, 80);
                        found_ch1 = true;
                    }
                    _ => panic!("Unexpected channel"),
                }
            }
        }

        assert!(
            found_ch0 && found_ch1,
            "Should find notes from both channels"
        );
    }

    #[test]
    fn test_bridge_notes_overlapping_notes() {
        // Test two notes with the same key overlapping (polyphonic)
        let note_on1 = create_midi_event(
            0,
            TrackEventKind::Midi {
                channel: 0.into(),
                message: MidiMessage::NoteOn {
                    key: 60.into(),
                    vel: 64.into(),
                },
            },
        );

        let note_on2 = create_midi_event(
            240, // Eighth note later
            TrackEventKind::Midi {
                channel: 0.into(),
                message: MidiMessage::NoteOn {
                    key: 60.into(), // Same key
                    vel: 80.into(),
                },
            },
        );

        let note_off1 = create_midi_event(
            240, // First note ends (total 480 ticks)
            TrackEventKind::Midi {
                channel: 0.into(),
                message: MidiMessage::NoteOff {
                    key: 60.into(),
                    vel: 0.into(),
                },
            },
        );

        let note_off2 = create_midi_event(
            240, // Second note ends (total 720 ticks)
            TrackEventKind::Midi {
                channel: 0.into(),
                message: MidiMessage::NoteOff {
                    key: 60.into(),
                    vel: 0.into(),
                },
            },
        );

        let track = vec![note_on1, note_on2, note_off1, note_off2];
        let note_events = bridge_notes_from_midi_track(&track);

        assert_eq!(note_events.len(), 2);

        let notes: Vec<_> = note_events
            .iter()
            .filter_map(|event| match event {
                BridgeEvent::Note(note) => Some(note),
                _ => None,
            })
            .collect();
        assert_eq!(notes[0].velocity, 64);
        assert_eq!(notes[0].midi_state.position_in_tick, 0);
        assert_eq!(notes[0].midi_state.duration_in_tick, 480);
        assert_eq!(notes[1].velocity, 80);
        assert_eq!(notes[1].midi_state.position_in_tick, 240);
        assert_eq!(notes[1].midi_state.duration_in_tick, 480);
    }

    #[test]
    fn test_bridge_notes_note_off_without_note_on() {
        // Test note off without corresponding note on (should be ignored)
        let note_off = create_midi_event(
            0,
            TrackEventKind::Midi {
                channel: 0.into(),
                message: MidiMessage::NoteOff {
                    key: 60.into(),
                    vel: 64.into(),
                },
            },
        );

        let track = vec![note_off];
        let note_events = bridge_notes_from_midi_track(&track);

        assert_eq!(note_events.len(), 0);
    }

    #[test]
    fn test_bridge_notes_complex_sequence() {
        // Test a more complex sequence with multiple notes and events
        let events = vec![
            // Program change at start
            create_midi_event(
                0,
                TrackEventKind::Midi {
                    channel: 0.into(),
                    message: MidiMessage::ProgramChange {
                        program: 25.into(), // Acoustic guitar
                    },
                },
            ),
            // First note
            create_midi_event(
                0,
                TrackEventKind::Midi {
                    channel: 0.into(),
                    message: MidiMessage::NoteOn {
                        key: 60.into(),
                        vel: 64.into(),
                    },
                },
            ),
            // Second note starts before first ends
            create_midi_event(
                240,
                TrackEventKind::Midi {
                    channel: 0.into(),
                    message: MidiMessage::NoteOn {
                        key: 64.into(),
                        vel: 80.into(),
                    },
                },
            ),
            // First note ends
            create_midi_event(
                240,
                TrackEventKind::Midi {
                    channel: 0.into(),
                    message: MidiMessage::NoteOff {
                        key: 60.into(),
                        vel: 0.into(),
                    },
                },
            ),
            // Second note ends
            create_midi_event(
                240,
                TrackEventKind::Midi {
                    channel: 0.into(),
                    message: MidiMessage::NoteOff {
                        key: 64.into(),
                        vel: 0.into(),
                    },
                },
            ),
        ];

        let note_events = bridge_notes_from_midi_track(&events);

        // Should have program change + 2 notes
        assert_eq!(note_events.len(), 3);

        // Verify program change
        match &note_events[0] {
            BridgeEvent::ProgramChange(instrument, _) => {
                assert_eq!(instrument.instrument_id, 25);
            }
            _ => panic!("Expected program change first"),
        }

        // Verify notes
        let mut found_c = false;
        let mut found_e = false;

        for event in &note_events[1..] {
            if let BridgeEvent::Note(note_state) = event {
                match note_state.key {
                    60 => {
                        assert_eq!(note_state.midi_state.position_in_tick, 0);
                        assert_eq!(note_state.midi_state.duration_in_tick, 480);
                        found_c = true;
                    }
                    64 => {
                        assert_eq!(note_state.midi_state.position_in_tick, 240);
                        assert_eq!(note_state.midi_state.duration_in_tick, 480);
                        found_e = true;
                    }
                    _ => panic!("Unexpected note key"),
                }
            }
        }

        assert!(found_c && found_e, "Should find both C and E notes");
    }

    #[test]
    fn test_bridge_notes_drum_channel() {
        // Test drum channel (channel 9/10 in 1-based indexing, 9 in 0-based)
        let program_change = create_midi_event(
            0,
            TrackEventKind::Midi {
                channel: 9.into(), // Drum channel
                message: MidiMessage::ProgramChange {
                    program: 0.into(), // Doesn't matter for drums
                },
            },
        );

        let track = vec![program_change];
        let note_events = bridge_notes_from_midi_track(&track);

        assert_eq!(note_events.len(), 1);

        match &note_events[0] {
            BridgeEvent::ProgramChange(instrument, _) => {
                assert_eq!(instrument.midi_channel, 9);
                assert_eq!(instrument.name, "Drum Set");
            }
            _ => panic!("Expected program change event"),
        }
    }
}
