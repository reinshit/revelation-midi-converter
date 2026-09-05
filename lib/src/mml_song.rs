use std::{collections::HashMap, fs, path::Path};

use anyhow::{Context, Result};
use midly::{Smf, Timing, TrackEvent};

use crate::{
    MmlTrack,
    mml_event::BridgeEvent,
    parser::{bridge_meta_from_midi_track, bridge_notes_from_midi_track},
    utils,
};

#[derive(Debug, Clone)]
pub struct MmlSongOptions {
    ///  Automatically increases the velocity to the highest level within the defined range.
    /// The boost is calculated from the current maximum velocity to the highest note velocity.
    pub auto_boot_velocity: bool,

    /// Automatically balances the number of notes between two tracks when performing a split action, ensuring even distribution.
    pub auto_equalize_note_length: bool,

    /// Defines the minimum velocity allowed for notes. The default velocity range is 0-15.
    pub velocity_min: u8,

    /// Defines the maximum velocity allowed for notes. The default velocity range is 0-15.
    pub velocity_max: u8,

    /// In MML:  
    /// 1. Each track is allowed to have only one note or chord played at any given time.
    /// 1. The position of the subsequent note depends on the length of the preceding note.
    ///
    /// When overlapping notes in MIDI are converted to MML, two scenarios can occur:  
    /// 1. If the start point of two notes is less than or equal to the min gap for chord, these notes will be combined into a chord.
    /// 1. If the start point of the following note minus the start point of the preceding note is greater than the min gap for chord, the preceding note will be shortened so that the position of the following note is accurate.
    ///
    /// The min gap for chord acts as a threshold condition, measured in the smallest unit.
    pub min_gap_for_chord: u8,

    /// The smallest unit in the process of converting MIDI to MML, by default, is a 1/64 note.
    pub smallest_unit: usize,
}
impl Default for MmlSongOptions {
    fn default() -> Self {
        Self {
            auto_boot_velocity: false,
            auto_equalize_note_length: false,
            velocity_min: 0,
            velocity_max: 15,
            min_gap_for_chord: 0,
            smallest_unit: 64,
        }
    }
}

#[derive(Debug, Clone)]
pub struct MmlSong {
    pub ppq: u16,
    pub tracks: Vec<MmlTrack>,
    pub options: MmlSongOptions,
    velocity_diff: Option<u8>,
}

impl MmlSong {
    pub fn from_path<P>(path: P, options: MmlSongOptions) -> Result<Self>
    where
        P: AsRef<Path>,
    {
        let bytes = fs::read(path)?;
        Self::from_bytes(bytes, options)
    }

    pub fn from_bytes(bytes: Vec<u8>, options: MmlSongOptions) -> Result<Self> {
        let smf = Smf::parse(&bytes)?;
        let ppq = get_ppq_from_smf(&smf).unwrap_or(480);

        let meta_events = get_bridge_meta_events(&smf.tracks);
        let bridge_note_events = get_bridge_note_events(&smf.tracks);

        let tracks = bridge_events_to_tracks(meta_events, bridge_note_events, &options, ppq);

        let mut song = Self {
            ppq,
            tracks,
            options,
            velocity_diff: None,
        };
        song.appy_song_options();

        Ok(song)
    }

    pub fn merge_tracks(&mut self, index_a: usize, index_b: usize) -> Result<()> {
        let mut track_b = self
            .tracks
            .get(index_b)
            .with_context(|| format!("Cannot get track by index_b = {}", index_b))?
            .to_owned();

        let track_a = self
            .tracks
            .get_mut(index_a)
            .with_context(|| format!("Cannot get track by index_a = {}", index_a))?;

        track_a.merge(&mut track_b);
        self.tracks.remove(index_b);

        Ok(())
    }

    pub fn split_track(&mut self, index: usize) -> Result<()> {
        let track = self
            .tracks
            .get_mut(index)
            .with_context(|| format!("Cannot get track by index {}", index))?;
        let (mut track_a, mut track_b) = track.split();

        if self.options.auto_boot_velocity
            && let Some(velocity_diff) = self.velocity_diff
        {
            track_a.apply_boot_velocity(velocity_diff);
            track_b.apply_boot_velocity(velocity_diff);
        }

        *track = track_a;
        self.tracks.insert(index + 1, track_b);

        Ok(())
    }

    pub fn equalize_tracks(&mut self, index_a: usize, index_b: usize) -> Result<()> {
        if index_a == index_b {
            return Err(anyhow::anyhow!("Cannot equalize the same track"));
        }

        let (track_a, track_b) = if index_a < index_b {
            let (before_b, from_b) = self.tracks.split_at_mut(index_b);
            let track_a = before_b
                .get_mut(index_a)
                .with_context(|| format!("Cannot get track by index {}", index_a))?;
            let track_b = from_b
                .first_mut()
                .with_context(|| format!("Cannot get track by index {}", index_b))?;
            (track_a, track_b)
        } else {
            let (before_a, from_a) = self.tracks.split_at_mut(index_a);
            let track_a = from_a
                .first_mut()
                .with_context(|| format!("Cannot get track by index {}", index_a))?;
            let track_b = before_a
                .get_mut(index_b)
                .with_context(|| format!("Cannot get track by index {}", index_b))?;
            (track_a, track_b)
        };

        utils::equalize_tracks(track_a, track_b);
        Ok(())
    }

    pub fn apply_keymap(&mut self, track_index: usize, keymap: &HashMap<u8, u8>) {
        if let Some(track) = self.tracks.get_mut(track_index) {
            track.apply_keymap(keymap);
        }
    }

    pub fn set_song_options(&mut self, options: MmlSongOptions) -> Result<()> {
        self.options = options.clone();
        self.tracks.iter_mut().for_each(|track| {
            track.song_options = options.clone();
            track.generate_mml_events();
        });
        self.appy_song_options();
        Ok(())
    }

    fn appy_song_options(&mut self) {
        if self.options.auto_boot_velocity {
            let velocity_diff = utils::get_song_velocity_diff(&self.options, &self.tracks);
            self.velocity_diff = Some(velocity_diff);
            utils::auto_boot_song_velocity(&mut self.tracks, velocity_diff);
        }
    }
}

fn bridge_events_to_tracks(
    bridge_meta_events: Vec<BridgeEvent>,
    bridge_events: Vec<Vec<BridgeEvent>>,
    song_options: &MmlSongOptions,
    ppq: u16,
) -> Vec<MmlTrack> {
    bridge_events
        .into_iter()
        .enumerate()
        .map(|(index, events)| {
            let options = song_options.to_owned();
            let meta_events = bridge_meta_events.to_owned();
            MmlTrack::from_bridge_events(index.to_string(), meta_events, events, options, ppq)
        })
        .collect()
}

fn get_bridge_note_events(smf_tracks: &Vec<Vec<TrackEvent>>) -> Vec<Vec<BridgeEvent>> {
    smf_tracks
        .iter()
        .map(bridge_notes_from_midi_track)
        .collect()
}

fn get_bridge_meta_events(smf_tracks: &Vec<Vec<TrackEvent>>) -> Vec<BridgeEvent> {
    smf_tracks
        .iter()
        .flat_map(bridge_meta_from_midi_track)
        .collect()
}

fn get_ppq_from_smf(smf: &Smf) -> Option<u16> {
    match smf.header.timing {
        Timing::Metrical(ppq) => Some(ppq.as_int()),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::MmlEvent;

    fn midi_with_track(division: [u8; 2], track: &[u8]) -> Vec<u8> {
        let mut bytes = b"MThd\0\0\0\x06\0\0\0\x01".to_vec();
        bytes.extend_from_slice(&division);
        bytes.extend_from_slice(b"MTrk");
        bytes.extend_from_slice(&(track.len() as u32).to_be_bytes());
        bytes.extend_from_slice(track);
        bytes
    }

    #[test]
    fn rejects_malformed_midi() {
        assert!(MmlSong::from_bytes(vec![1, 2, 3], MmlSongOptions::default()).is_err());
    }

    #[test]
    fn accepts_an_empty_midi_track() {
        let song = MmlSong::from_bytes(
            midi_with_track([0x01, 0xe0], &[0x00, 0xff, 0x2f, 0x00]),
            MmlSongOptions::default(),
        )
        .unwrap();
        assert_eq!(song.ppq, 480);
        assert_eq!(song.tracks.len(), 1);
        assert!(song.tracks[0].to_mml().is_empty());
    }

    #[test]
    fn uses_legacy_ppq_fallback_for_smpte_timing() {
        let song = MmlSong::from_bytes(
            midi_with_track([0xe7, 0x28], &[0x00, 0xff, 0x2f, 0x00]),
            MmlSongOptions::default(),
        )
        .unwrap();
        assert_eq!(song.ppq, 480);
    }

    #[test]
    fn drops_a_note_without_note_off_instead_of_hanging() {
        let song = MmlSong::from_bytes(
            midi_with_track(
                [0x01, 0xe0],
                &[0x00, 0x90, 0x3c, 0x64, 0x00, 0xff, 0x2f, 0x00],
            ),
            MmlSongOptions::default(),
        )
        .unwrap();
        assert!(song.tracks[0].events.iter().all(|event| !matches!(event, MmlEvent::Note(_))));
    }
}
