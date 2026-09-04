import type { PlaybackEvent, SongSnapshot } from '@/lib/wasm/types';
import type { WorkletSynthesizer } from 'spessasynth_lib';

export interface PlaybackRange { charStart: number; charEnd: number }
type ProgressListener = (positionSeconds: number, durationSeconds: number, activeRange?: PlaybackRange) => void;

export class BrowserMidiPlayer {
  private context: AudioContext | undefined;
  private master: GainNode | undefined;
  private synth: WorkletSynthesizer | undefined;
  private synthPromise: Promise<WorkletSynthesizer> | undefined;
  private sources: OscillatorNode[] = [];
  private animationFrame: number | undefined;
  private startedAt = 0;
  private pausedAt = 0;
  private duration = 0;
  private snapshot: SongSnapshot | undefined;
  private listener: ProgressListener | undefined;
  private highlights: (PlaybackRange & { start: number; end: number })[] = [];
  private highlightTrackIndex = 0;
  private volume = 0.75;
  private playbackMode: 'soundfont' | 'fallback' = 'fallback';
  private playbackWarning: string | undefined;
  private playbackGeneration = 0;

  get isPlaying() {
    return this.animationFrame !== undefined;
  }

  get mode() {
    return this.playbackMode;
  }

  get warning() {
    return this.playbackWarning;
  }

  async play(snapshot: SongSnapshot, listener: ProgressListener, highlightTrackIndex = 0) {
    const generation = ++this.playbackGeneration;
    this.stopSources();
    this.snapshot = snapshot;
    this.listener = listener;
    this.highlightTrackIndex = highlightTrackIndex;
    this.playbackWarning = undefined;
    this.context ??= new AudioContext();
    await this.context.resume();
    const synth = await this.getSynth().catch((cause) => {
      this.playbackWarning = cause instanceof Error ? cause.message : String(cause);
      return undefined;
    });
    if (generation !== this.playbackGeneration) {
      if (synth) this.destroySynth();
      return;
    }
    this.playbackMode = synth ? 'soundfont' : 'fallback';
    if (!synth) {
      this.master ??= this.context.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.context.destination);
    }

    const tempoMap = buildTempoMap(snapshot);
    const notes = snapshot.tracks.flatMap((track) =>
      track.playback_events
        .filter((event): event is Extract<PlaybackEvent, { type: 'note' }> => event.type === 'note')
        .map((note) => ({ ...note, channel: track.instrument.channel % 16 })),
    );
    this.duration = notes.reduce(
      (maximum, note) => Math.max(maximum, secondsAt(note.position_units + note.duration_units, tempoMap, snapshot.options.smallest_unit)),
      0,
    );
    this.highlights = (snapshot.tracks[highlightTrackIndex]?.playback_events ?? [])
      .filter((event): event is Extract<PlaybackEvent, { type: 'note' }> => event.type === 'note')
      .map((note) => ({
        start: secondsAt(note.position_units, tempoMap, snapshot.options.smallest_unit),
        end: secondsAt(note.position_units + note.duration_units, tempoMap, snapshot.options.smallest_unit),
        charStart: note.char_start,
        charEnd: note.char_end,
      }));
    if (this.pausedAt >= this.duration) this.pausedAt = 0;

    const now = this.context.currentTime + 0.04;
    this.startedAt = now - this.pausedAt;
    if (synth) {
      for (const track of snapshot.tracks) {
        const programs = track.playback_events
          .filter((event): event is Extract<PlaybackEvent, { type: 'program' }> => event.type === 'program')
          .sort((left, right) => left.position_units - right.position_units);
        const initial = programs.findLast((event) => secondsAt(event.position_units, tempoMap, snapshot.options.smallest_unit) <= this.pausedAt);
        const channel = (initial?.channel ?? programs[0]?.channel ?? track.instrument.channel) % 16;
        const program = initial?.program ?? programs[0]?.program ?? track.instrument.program;
        synth.midiChannels[channel]?.setDrums(channel === 9);
        synth.programChange(channel, program, { time: now });
        for (const event of programs) {
          const eventTime = secondsAt(event.position_units, tempoMap, snapshot.options.smallest_unit);
          if (eventTime <= this.pausedAt) continue;
          synth.programChange(event.channel % 16, event.program, { time: now + eventTime - this.pausedAt });
        }
      }
    }
    for (const note of notes) {
      const noteStart = secondsAt(note.position_units, tempoMap, snapshot.options.smallest_unit);
      const noteEnd = secondsAt(note.position_units + note.duration_units, tempoMap, snapshot.options.smallest_unit);
      if (noteEnd <= this.pausedAt) continue;
      const start = now + Math.max(0, noteStart - this.pausedAt);
      const duration = noteEnd - Math.max(noteStart, this.pausedAt);
      if (synth) {
        synth.noteOn(note.channel, note.key, Math.round((note.velocity / 15) * 127), { time: start });
        synth.noteOff(note.channel, note.key, { time: start + duration });
      } else {
        this.scheduleFallbackNote(note.key, note.velocity, start, duration);
      }
    }
    this.tick();
  }

  pause() {
    if (!this.context || !this.isPlaying) return;
    this.pausedAt = Math.min(this.duration, this.context.currentTime - this.startedAt);
    this.playbackGeneration++;
    this.stopSources();
    this.listener?.(this.pausedAt, this.duration, this.rangeAt(this.pausedAt));
  }

  stop() {
    this.playbackGeneration++;
    this.stopSources();
    this.pausedAt = 0;
    this.listener?.(0, this.duration);
  }

  async seek(positionSeconds: number) {
    if (!this.snapshot || !this.listener) return;
    const shouldResume = this.isPlaying;
    const target = Math.max(0, Math.min(this.duration, positionSeconds));
    if (target >= this.duration) {
      this.playbackGeneration++;
      this.stopSources();
      this.pausedAt = 0;
      this.listener(this.duration, this.duration);
      return;
    }
    this.pausedAt = target;
    if (shouldResume) {
      await this.play(this.snapshot, this.listener, this.highlightTrackIndex);
    } else {
      this.listener(this.pausedAt, this.duration, this.rangeAt(this.pausedAt));
    }
  }

  async resume() {
    if (this.snapshot && this.listener) await this.play(this.snapshot, this.listener, this.highlightTrackIndex);
  }

  setVolume(value: number) {
    this.volume = Math.max(0, Math.min(1, value));
    if (this.master) this.master.gain.value = this.volume;
    this.synth?.setSystemParameter('gain', this.volume);
  }

  dispose() {
    this.playbackGeneration++;
    this.stop();
    void this.context?.close();
    this.context = undefined;
    this.master = undefined;
  }

  private async getSynth() {
    if (this.synth) return this.synth;
    if (!this.context) throw new Error('AudioContext is not available.');
    this.synthPromise ??= (async () => {
      const { WorkletSynthesizer } = await import('spessasynth_lib');
      await this.context!.audioWorklet.addModule('/spessasynth/spessasynth_processor.min.js');
      const synth = new WorkletSynthesizer(this.context!);
      synth.connect(this.context!.destination);
      const response = await fetch('/soundfonts/generaluser-gs.sf2');
      if (!response.ok) throw new Error(`SoundFont failed to load (${response.status}).`);
      await synth.soundBankManager.addSoundBank(await response.arrayBuffer(), 'reve-midi-gm');
      await synth.isReady;
      synth.setSystemParameter('gain', this.volume);
      this.synth = synth;
      return synth;
    })().catch((error) => {
      this.synthPromise = undefined;
      throw error;
    });
    return this.synthPromise;
  }

  private scheduleFallbackNote(key: number, velocity: number, start: number, duration: number) {
    if (!this.context || !this.master || duration <= 0) return;
    const oscillator = this.context.createOscillator();
    const envelope = this.context.createGain();
    const level = Math.max(0.006, (velocity / 15) * 0.035);
    oscillator.type = 'triangle';
    oscillator.frequency.value = 440 * 2 ** ((key - 69) / 12);
    envelope.gain.setValueAtTime(0, start);
    envelope.gain.linearRampToValueAtTime(level, start + Math.min(0.01, duration / 4));
    envelope.gain.setValueAtTime(level, start + Math.max(0.01, duration - 0.02));
    envelope.gain.linearRampToValueAtTime(0, start + duration);
    oscillator.connect(envelope).connect(this.master);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.01);
    oscillator.onended = () => {
      this.sources = this.sources.filter((source) => source !== oscillator);
      oscillator.disconnect();
      envelope.disconnect();
    };
    this.sources.push(oscillator);
  }

  private tick = () => {
    if (!this.context) return;
    const position = Math.min(this.duration, this.context.currentTime - this.startedAt);
    this.listener?.(position, this.duration, this.rangeAt(position));
    if (position >= this.duration) {
      this.stopSources();
      this.pausedAt = 0;
      return;
    }
    this.animationFrame = requestAnimationFrame(this.tick);
  };

  private stopSources() {
    if (this.animationFrame !== undefined) cancelAnimationFrame(this.animationFrame);
    this.animationFrame = undefined;
    this.destroySynth();
    for (const source of this.sources) {
      source.onended = null;
      try { source.stop(); } catch { /* already stopped */ }
      source.disconnect();
    }
    this.sources = [];
  }

  private destroySynth() {
    if (!this.synth) return;
    this.synth.stopAll(true);
    if (this.context) this.synth.disconnect(this.context.destination);
    this.synth.destroy();
    this.synth = undefined;
    this.synthPromise = undefined;
  }

  private rangeAt(position: number): PlaybackRange | undefined {
    return this.highlights.find((range) => range.start <= position && position < range.end);
  }
}

interface TempoPoint { position: number; bpm: number }

export function buildTempoMap(snapshot: SongSnapshot): TempoPoint[] {
  const byPosition = new Map<number, number>([[0, 120]]);
  for (const event of snapshot.tracks.flatMap((track) => track.playback_events)) {
    if (event.type === 'tempo') byPosition.set(event.position_units, event.bpm);
  }
  return [...byPosition].map(([position, bpm]) => ({ position, bpm })).sort((a, b) => a.position - b.position);
}

export function secondsAt(units: number, tempos: TempoPoint[], smallestUnit: number) {
  let seconds = 0;
  let position = 0;
  let bpm = 120;
  for (const tempo of tempos) {
    if (tempo.position >= units) break;
    seconds += (tempo.position - position) * secondsPerUnit(bpm, smallestUnit);
    position = tempo.position;
    bpm = tempo.bpm;
  }
  return seconds + (units - position) * secondsPerUnit(bpm, smallestUnit);
}

function secondsPerUnit(bpm: number, smallestUnit: number) {
  return (60 / bpm) * (4 / smallestUnit);
}
