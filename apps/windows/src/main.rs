use std::path::Path;

use anyhow::{Context, Result};
use midi_to_mml::{MmlSong, MmlSongOptions};
use slint::SharedString;

slint::include_modules!();

fn main() -> Result<()> {
    let window = AppWindow::new().context("cannot create the application window")?;
    bind_browse(&window);
    bind_convert(&window);
    window.run().context("application event loop failed")?;
    Ok(())
}

fn bind_browse(window: &AppWindow) {
    let weak = window.as_weak();
    window.on_browse_requested(move || {
        let Some(window) = weak.upgrade() else {
            return;
        };

        if let Some(path) = rfd::FileDialog::new()
            .add_filter("MIDI files", &["mid", "midi"])
            .pick_file()
        {
            window.set_midi_path(path.to_string_lossy().into());
            window.set_status_text("MIDI file selected".into());
        }
    });
}

fn bind_convert(window: &AppWindow) {
    let weak = window.as_weak();
    window.on_convert_requested(move || {
        let Some(window) = weak.upgrade() else {
            return;
        };

        window.set_status_text("Converting...".into());
        let path = window.get_midi_path().to_string();
        match convert_path(Path::new(&path)) {
            Ok(output) => {
                window.set_mml_output(output.into());
                window.set_status_text("Conversion completed".into());
            }
            Err(error) => {
                window.set_mml_output(SharedString::default());
                window.set_status_text(format!("Conversion failed: {error:#}").into());
            }
        }
    });
}

fn convert_path(path: &Path) -> Result<String> {
    if path.as_os_str().is_empty() {
        anyhow::bail!("select a MIDI file first");
    }

    let song = MmlSong::from_path(path, MmlSongOptions::default())
        .with_context(|| format!("cannot convert {}", path.display()))?;
    let output = song
        .tracks
        .iter()
        .enumerate()
        .map(|(index, track)| {
            format!(
                "Track {} — {} — {}\n{}",
                index + 1,
                track.name,
                track.instrument.name,
                track.to_mml()
            )
        })
        .collect::<Vec<_>>()
        .join("\n\n");
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_repository_fixture() {
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("..")
            .join("assets")
            .join("cloudless-yorushika.mid");
        let output = convert_path(&path).expect("fixture conversion must succeed");
        assert!(output.starts_with("Track 1"));
        assert!(output.contains("t"));
        assert!(output.contains("o"));
    }

    #[test]
    fn rejects_empty_path() {
        let error = convert_path(Path::new("")).expect_err("empty path must fail");
        assert!(error.to_string().contains("select a MIDI file"));
    }
}
