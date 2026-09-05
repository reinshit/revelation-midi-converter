'use client';

import { useEffect, useRef, useState } from 'react';
import {
  AlignHorizontalDistributeCenter,
  ArrowRightLeft,
  AudioWaveform,
  Combine,
  Copy,
  FileAudio,
  FileCode2,
  FileDown,
  FileUp,
  FolderOpen,
  LoaderCircle,
  Pause,
  Pencil,
  Play,
  RotateCcw,
  SlidersHorizontal,
  Split,
  Square,
  Trash2,
  Volume2,
  WandSparkles,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ConverterWorkerClient } from '@/lib/wasm/worker-client';
import { BrowserMidiPlayer } from '@/lib/audio/player';
import type { PlaybackRange } from '@/lib/audio/player';
import type {
  SongOptions,
  SongSnapshot,
  TrackSnapshot,
} from '@/lib/wasm/types';
import { defaultSongOptions } from '@/lib/wasm/types';
import {
  downloadMml,
  downloadProject,
  readProject,
} from '@/lib/storage/project';
import type { RestoredProject } from '@/lib/storage/project';
import {
  clearProjectData,
  loadKeymap,
  loadRecentProject,
  saveKeymap,
  saveRecentProject,
} from '@/lib/storage/recent-project';
import {
  clearPreferences,
  loadPreferences,
  savePreferences,
} from '@/lib/storage/preferences';

const emptyTrack: TrackSnapshot = {
  index: 0,
  name: '',
  instrument: { name: '', program: 0, channel: 0 },
  mml: '',
  mml_note_length: 0,
  playback_events: [],
};

export default function Home() {
  const input = useRef<HTMLInputElement>(null);
  const projectInput = useRef<HTMLInputElement>(null);
  const converter = useRef<ConverterWorkerClient | undefined>(undefined);
  const busyRef = useRef(false);
  const player = useRef<BrowserMidiPlayer | undefined>(undefined);
  const seekTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const [file, setFile] = useState<File>();
  const [sourceName, setSourceName] = useState<string>();
  const [snapshot, setSnapshot] = useState<SongSnapshot>();
  const [activeTrack, setActiveTrack] = useState(0);
  const [comparisonTrack, setComparisonTrack] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [warning, setWarning] = useState<string>();
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [seekPosition, setSeekPosition] = useState<number>();
  const [duration, setDuration] = useState(0);
  const [activeRange, setActiveRange] = useState<PlaybackRange>();
  const [volume, setVolume] = useState(75);
  const [audioStatus, setAudioStatus] = useState<
    'idle' | 'loading' | 'soundfont' | 'fallback'
  >('idle');
  const [playbackPending, setPlaybackPending] = useState(false);
  const playbackPendingRef = useRef(false);
  const [options, setOptions] = useState<SongOptions>(() => loadPreferences());
  const [keymapOpen, setKeymapOpen] = useState(false);
  const [keymapText, setKeymapText] = useState('{\n  "60": 72\n}');
  const [recentProject, setRecentProject] = useState<RestoredProject>();

  const tracks = snapshot?.tracks ?? [];
  const selected = tracks[activeTrack] ?? tracks[0] ?? emptyTrack;
  const sliderPosition =
    seekPosition ??
    Math.max(0, Math.min(duration, Math.round(position * 100) / 100));

  useEffect(
    () => () => {
      if (seekTimer.current) clearTimeout(seekTimer.current);
      converter.current?.dispose();
      player.current?.dispose();
    },
    [],
  );

  useEffect(() => {
    void loadRecentProject()
      .then(setRecentProject)
      .catch(() => undefined);
    void loadKeymap('default')
      .then((mapping) => {
        if (mapping) setKeymapText(JSON.stringify(mapping, null, 2));
      })
      .catch(() => undefined);
  }, []);

  async function convert() {
    if (busyRef.current) return;
    if (!file) {
      openMidiPicker();
      return;
    }
    await loadMidi(file);
  }

  function openMidiPicker() {
    if (busyRef.current || !input.current) return;
    input.current.value = '';
    input.current.click();
  }

  function openProjectPicker() {
    if (busyRef.current || !projectInput.current) return;
    projectInput.current.value = '';
    projectInput.current.click();
  }

  async function loadMidi(selectedFile: File) {
    if (!startOperation()) return;
    setError(undefined);
    setWarning(undefined);
    try {
      converter.current ??= new ConverterWorkerClient();
      const result = await converter.current.load(
        await selectedFile.arrayBuffer(),
        options,
      );
      setSourceName(selectedFile.name);
      applySnapshot(result, 0);
      setFile((current) => (current === selectedFile ? undefined : current));
      await saveRecentProject(
        selectedFile.name,
        converter.current.getProjectState(),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      finishOperation();
    }
  }

  async function restoreProject(selectedFile: File) {
    if (!startOperation()) return;
    setError(undefined);
    setWarning(undefined);
    try {
      await restoreProjectState(await readProject(selectedFile));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      finishOperation();
    }
  }

  async function restoreProjectState(project: RestoredProject) {
    const nextConverter = new ConverterWorkerClient();
    let result: SongSnapshot;
    try {
      result = await nextConverter.restore(
        project.sourceBytes,
        project.initialOptions,
        project.mutations,
      );
    } catch (cause) {
      nextConverter.dispose();
      throw cause;
    }
    converter.current?.dispose();
    converter.current = nextConverter;
    setFile(undefined);
    setSourceName(project.name);
    applySnapshot(result, 0);
    await saveRecentProject(project.name, nextConverter.getProjectState());
  }

  async function restoreRecentProject() {
    if (!recentProject || !startOperation()) return;
    setError(undefined);
    setWarning(undefined);
    try {
      await restoreProjectState(recentProject);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      finishOperation();
    }
  }

  function saveProject() {
    if (!converter.current || !sourceName) return;
    downloadProject(sourceName, converter.current.getProjectState());
  }

  function selectTrack(track: TrackSnapshot) {
    stopPlayback();
    setActiveTrack(track.index);
    setComparisonTrack((current) =>
      current === track.index
        ? (tracks.find((candidate) => candidate.index !== track.index)?.index ??
          0)
        : current,
    );
  }

  function applySnapshot(result: SongSnapshot, requestedIndex = activeTrack) {
    resetPlaybackForSnapshot();
    const nextIndex = Math.min(
      requestedIndex,
      Math.max(0, result.tracks.length - 1),
    );
    setSnapshot(result);
    setOptions(result.options);
    setActiveTrack(nextIndex);
    setComparisonTrack((current) =>
      current < result.tracks.length && current !== nextIndex
        ? current
        : (result.tracks.find((track) => track.index !== nextIndex)?.index ??
          nextIndex),
    );
  }

  async function runOperation(
    operation: (client: ConverterWorkerClient) => Promise<SongSnapshot>,
    requestedIndex = activeTrack,
  ) {
    if (!converter.current || !startOperation()) return false;
    resetPlaybackForSnapshot();
    setError(undefined);
    try {
      applySnapshot(await operation(converter.current), requestedIndex);
      if (sourceName)
        await saveRecentProject(
          sourceName,
          converter.current.getProjectState(),
        );
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return false;
    } finally {
      finishOperation();
    }
  }

  async function updateOptions(patch: Partial<SongOptions>) {
    if (busyRef.current) return;
    const next = { ...options, ...patch };
    if (converter.current) {
      if (await runOperation((client) => client.updateOptions(next)))
        savePreferences(next);
    } else {
      setOptions(next);
      savePreferences(next);
    }
  }

  function renameSelected() {
    const name = window.prompt('Track name', selected.name)?.trim();
    if (name)
      void runOperation((client) => client.renameTrack(activeTrack, name));
  }

  async function togglePlayback() {
    if (!snapshot || playbackPendingRef.current) return;
    player.current ??= new BrowserMidiPlayer();
    if (player.current.isPlaying) {
      player.current.pause();
      setPlaying(false);
      setAudioStatus('idle');
    } else {
      playbackPendingRef.current = true;
      setPlaybackPending(true);
      setAudioStatus('loading');
      setError(undefined);
      setWarning(undefined);
      try {
        await player.current.play(snapshot, updateProgress, activeTrack);
        setPlaying(player.current.isPlaying);
        setAudioStatus(player.current.isPlaying ? player.current.mode : 'idle');
        if (player.current.warning)
          setWarning(
            `Studio instruments could not load, so simple tones are being used. ${player.current.warning}`,
          );
      } catch (cause) {
        setAudioStatus('idle');
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        playbackPendingRef.current = false;
        setPlaybackPending(false);
      }
    }
  }

  function updateProgress(
    nextPosition: number,
    nextDuration: number,
    range?: PlaybackRange,
  ) {
    setPosition(nextPosition);
    setDuration(nextDuration);
    setActiveRange(range);
    if (nextDuration > 0 && nextPosition >= nextDuration) {
      setPlaying(false);
      setAudioStatus('idle');
    }
  }

  function stopPlayback() {
    player.current?.stop();
    setPlaying(false);
    setSeekPosition(undefined);
    setActiveRange(undefined);
    setAudioStatus('idle');
  }

  function resetPlaybackForSnapshot() {
    player.current?.stop();
    setPlaying(false);
    setPosition(0);
    setSeekPosition(undefined);
    setDuration(0);
    setActiveRange(undefined);
    setAudioStatus('idle');
  }

  function queueSeek(value: number) {
    setSeekPosition(value);
    if (seekTimer.current) clearTimeout(seekTimer.current);
    seekTimer.current = setTimeout(() => {
      seekTimer.current = undefined;
      setSeekPosition(undefined);
      void player.current?.seek(value);
    }, 150);
  }

  function commitSeek(value: number) {
    if (seekTimer.current) clearTimeout(seekTimer.current);
    seekTimer.current = undefined;
    setSeekPosition(undefined);
    void player.current?.seek(value);
  }

  async function applyKeymap() {
    try {
      const raw: unknown = JSON.parse(keymapText);
      if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        throw new Error('The note mapping must use the shown JSON format');
      const mapping: Record<number, number> = {};
      for (const [fromText, toValue] of Object.entries(raw)) {
        const from = Number(fromText);
        if (
          !Number.isInteger(from) ||
          from < 0 ||
          from > 127 ||
          !Number.isInteger(toValue) ||
          Number(toValue) < 0 ||
          Number(toValue) > 127
        ) {
          throw new Error(
            'Every note number must be a whole number from 0 to 127',
          );
        }
        mapping[from] = Number(toValue);
      }
      const applied = await runOperation((client) =>
        client.applyKeymap(activeTrack, mapping),
      );
      if (!applied) return;
      await saveKeymap('default', mapping);
      setKeymapOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function clearLocalData() {
    if (busyRef.current) return;
    if (
      !window.confirm(
        'Clear saved projects, note mappings, and preferences from this browser? The currently open project will remain available until this tab is closed.',
      )
    )
      return;
    if (!startOperation()) return;
    setError(undefined);
    try {
      await clearProjectData();
      clearPreferences();
      setRecentProject(undefined);
      if (!snapshot) setOptions(defaultSongOptions);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      finishOperation();
    }
  }

  function startOperation() {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    return true;
  }

  function finishOperation() {
    busyRef.current = false;
    setBusy(false);
  }

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isEditing = target?.matches(
        'input, textarea, select, [contenteditable="true"]',
      );
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'o') {
        event.preventDefault();
        openMidiPicker();
      } else if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === 's'
      ) {
        event.preventDefault();
        saveProject();
      } else if (event.code === 'Space' && !isEditing && snapshot) {
        event.preventDefault();
        void togglePlayback();
      }
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  });

  return (
    <main className="app-shell min-h-dvh pb-20 text-foreground">
      <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur-md">
        <div className="mx-auto flex min-h-18 max-w-[1440px] items-center gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <div className="grid size-11 shrink-0 place-items-center rounded-2xl bg-primary text-primary-foreground">
            <AudioWaveform className="size-5" aria-hidden="true" />
          </div>
          <div>
            <h1 className="font-heading text-base font-bold tracking-tight sm:text-lg">
              Revelation MIDI Converter
            </h1>
            <p className="mt-0.5 text-xs text-muted-foreground sm:text-sm">
              Processed locally in your browser
            </p>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-[1440px] px-4 py-5 sm:px-6 sm:py-7 lg:px-8">
        <div
          className="mb-5 flex flex-col gap-4 rounded-3xl border bg-card p-4 sm:p-5 lg:flex-row lg:items-center lg:justify-between"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            if (busyRef.current) return;
            const dropped = event.dataTransfer.files[0];
            if (dropped) void loadMidi(dropped);
          }}
        >
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-accent text-accent-foreground">
              <FileAudio className="size-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">
                {file
                  ? `${file.name} is ready to convert`
                  : (sourceName ?? 'Choose or drop a MIDI file here')}
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>
                  {tracks.length} {tracks.length === 1 ? 'track' : 'tracks'}
                </span>
                <span aria-hidden="true">/</span>
                <span>
                  {snapshot
                    ? `Timing detail ${snapshot.ppq} pulses`
                    : 'No timing data'}
                </span>
                <Badge variant="secondary">
                  {file ? 'Ready' : snapshot ? 'Converted' : 'Empty'}
                </Badge>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            <input
              ref={input}
              type="file"
              aria-label="MIDI file"
              disabled={busy}
              accept=".mid,.midi,audio/midi"
              className="sr-only"
              onChange={(event) => {
                const selected = event.target.files?.[0];
                setFile(selected);
                setError(undefined);
                setWarning(undefined);
              }}
            />
            <input
              ref={projectInput}
              type="file"
              accept=".json,application/json"
              aria-label="Project file"
              disabled={busy}
              className="sr-only"
              onChange={(event) => {
                const selected = event.target.files?.[0];
                if (selected) void restoreProject(selected);
              }}
            />
            <Button variant="outline" onClick={openMidiPicker} disabled={busy}>
              <FileUp className="size-4" aria-hidden="true" /> Choose MIDI
            </Button>
            <Button onClick={convert} disabled={busy}>
              {busy ? (
                <LoaderCircle
                  className="size-4 animate-spin"
                  aria-hidden="true"
                />
              ) : (
                <WandSparkles className="size-4" aria-hidden="true" />
              )}{' '}
              {busy ? 'Processing...' : 'Convert'}
            </Button>
            <Button
              variant="outline"
              size="icon"
              title="Open project"
              aria-label="Open project"
              disabled={busy}
              onClick={openProjectPicker}
            >
              <FolderOpen className="size-4" aria-hidden="true" />
            </Button>
            {recentProject && !snapshot ? (
              <Button
                variant="outline"
                title="Restore last project"
                disabled={busy}
                onClick={() => void restoreRecentProject()}
              >
                <RotateCcw className="size-4" aria-hidden="true" /> Restore
              </Button>
            ) : null}
            <Button
              variant="outline"
              size="icon"
              title="Save project"
              aria-label="Save project"
              disabled={!snapshot || busy}
              onClick={saveProject}
            >
              <FileDown className="size-4" aria-hidden="true" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              title="Export converted code"
              aria-label="Export converted code"
              disabled={!snapshot || busy}
              onClick={() =>
                snapshot &&
                downloadMml(sourceName ?? 'song.mid', snapshot.tracks)
              }
            >
              <FileCode2 className="size-4" aria-hidden="true" />
            </Button>
          </div>
        </div>

        {error ? (
          <p
            role="alert"
            className="mb-5 rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive"
          >
            Something went wrong. {error}
          </p>
        ) : null}

        {warning ? (
          <output className="mb-5 block rounded-2xl border border-primary/30 bg-primary/10 px-4 py-3 text-sm font-medium text-foreground">
            {warning}
          </output>
        ) : null}

        {snapshot ? (
          <div className="grid items-start gap-4 md:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[240px_minmax(0,1fr)_300px]">
            <Card className="h-fit gap-0 overflow-hidden py-0 shadow-[0_18px_60px_oklch(0.06_0.05_300/0.5)]">
              <CardHeader className="flex-row items-center justify-between border-b px-4 py-3">
                <CardTitle className="text-sm">Tracks</CardTitle>
                <Badge variant="outline">{tracks.length}</Badge>
              </CardHeader>
              <CardContent className="space-y-1 p-2">
                {tracks.map((track) => (
                  <button
                    key={track.index}
                    type="button"
                    onClick={() => selectTrack(track)}
                    aria-pressed={activeTrack === track.index}
                    className={`min-h-18 w-full rounded-2xl border px-3 py-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${activeTrack === track.index ? 'border-primary/35 bg-primary/10' : 'border-transparent hover:bg-muted'}`}
                  >
                    <span className="flex justify-between gap-2 text-sm font-medium">
                      <span className="truncate">{track.name}</span>
                      <span className="font-mono text-xs tabular-nums text-muted-foreground">
                        {String(track.index + 1).padStart(2, '0')}
                      </span>
                    </span>
                    <span className="mt-1 block truncate text-xs text-muted-foreground">
                      {track.instrument.name}
                    </span>
                    <span className="mt-2 block text-xs text-muted-foreground">
                      {track.mml_note_length} converted notes
                    </span>
                  </button>
                ))}
              </CardContent>
            </Card>

            <Card className="min-w-0 gap-0 overflow-hidden py-0 shadow-[0_18px_60px_oklch(0.06_0.05_300/0.5)]">
              <CardHeader className="flex-row items-center justify-between border-b px-4 py-3">
                <div className="min-w-0">
                  <CardTitle className="truncate text-sm">
                    {selected.name}
                  </CardTitle>
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {selected.instrument.name}
                  </p>
                </div>
                <div className="flex flex-wrap justify-end gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Rename"
                    aria-label="Rename selected track"
                    disabled={!snapshot || busy}
                    onClick={renameSelected}
                  >
                    <Pencil className="size-4" aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Separate overlapping notes"
                    aria-label="Separate overlapping notes"
                    disabled={!snapshot || busy}
                    onClick={() =>
                      void runOperation((client) =>
                        client.splitTrack(activeTrack),
                      )
                    }
                  >
                    <Split className="size-4" aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Combine with partner track"
                    aria-label="Combine with partner track"
                    disabled={!snapshot || tracks.length < 2 || busy}
                    onClick={() =>
                      void runOperation(
                        (client) =>
                          client.mergeTracks(activeTrack, comparisonTrack),
                        Math.min(activeTrack, comparisonTrack),
                      )
                    }
                  >
                    <Combine className="size-4" aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Align with partner track"
                    aria-label="Align with partner track"
                    disabled={!snapshot || tracks.length < 2 || busy}
                    onClick={() =>
                      void runOperation((client) =>
                        client.equalizeTracks(activeTrack, comparisonTrack),
                      )
                    }
                  >
                    <AlignHorizontalDistributeCenter
                      className="size-4"
                      aria-hidden="true"
                    />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Copy converted code"
                    aria-label="Copy converted code"
                    onClick={() => navigator.clipboard?.writeText(selected.mml)}
                  >
                    <Copy className="size-4" aria-hidden="true" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-4">
                {playing ? (
                  <pre
                    aria-label="Converted MML code with playback highlighting"
                    className="min-h-[360px] overflow-auto whitespace-pre-wrap break-all rounded-2xl border bg-editor px-4 py-3 font-mono text-[13px] leading-7 md:min-h-[480px]"
                  >
                    {activeRange ? (
                      <>
                        {selected.mml.slice(0, activeRange.charStart)}
                        <mark className="rounded bg-primary px-0.5 text-primary-foreground">
                          {selected.mml.slice(
                            activeRange.charStart,
                            activeRange.charEnd,
                          )}
                        </mark>
                        {selected.mml.slice(activeRange.charEnd)}
                      </>
                    ) : (
                      selected.mml
                    )}
                  </pre>
                ) : (
                  <Textarea
                    aria-label="Converted MML code"
                    value={selected.mml}
                    readOnly
                    spellCheck={false}
                    className="min-h-[360px] resize-none rounded-2xl border bg-editor px-4 py-3 font-mono text-[13px] leading-7 md:min-h-[480px]"
                  />
                )}
                <div className="mt-3 flex justify-between text-xs text-muted-foreground">
                  <span>{selected.mml.length} characters</span>
                  <span>{selected.mml_note_length} notes</span>
                </div>
              </CardContent>
            </Card>

            <Card className="h-fit gap-0 overflow-hidden py-0 shadow-[0_18px_60px_oklch(0.06_0.05_300/0.5)] md:col-span-2 xl:col-span-1">
              <CardHeader className="flex-row items-center gap-2 border-b px-4 py-3">
                <SlidersHorizontal className="size-4" aria-hidden="true" />
                <CardTitle className="text-sm">Conversion settings</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6 p-4">
                <label
                  className="block text-sm font-medium"
                  htmlFor="comparison-track"
                >
                  Partner track
                </label>
                <p className="-mt-4 text-xs leading-5 text-muted-foreground">
                  Used when combining tracks or aligning their timing.
                </p>
                <select
                  id="comparison-track"
                  value={comparisonTrack}
                  disabled={!snapshot || tracks.length < 2 || busy}
                  onChange={(event) =>
                    setComparisonTrack(Number(event.target.value))
                  }
                  className="min-h-11 w-full rounded-xl border bg-background px-3 py-2 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:text-sm"
                >
                  {tracks
                    .filter((track) => track.index !== activeTrack)
                    .map((track) => (
                      <option key={track.index} value={track.index}>
                        {track.index + 1}. {track.name}
                      </option>
                    ))}
                </select>
                <div className="flex items-start justify-between gap-4">
                  <span>
                    <span className="block text-sm font-medium">
                      Balance quiet notes
                    </span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      Raises softer notes to keep their intensity consistent.
                    </span>
                  </span>
                  <Switch
                    checked={options.auto_boot_velocity}
                    disabled={busy}
                    onCheckedChange={(checked) =>
                      void updateOptions({ auto_boot_velocity: checked })
                    }
                    aria-label="Balance quiet notes"
                  />
                </div>
                <OptionSlider
                  label="Note intensity"
                  description="Sets the minimum and maximum strength of converted notes."
                  value={`${options.velocity_min} - ${options.velocity_max}`}
                  values={[options.velocity_min, options.velocity_max]}
                  min={0}
                  max={15}
                  step={1}
                  disabled={busy}
                  onChange={([velocity_min, velocity_max]) =>
                    void updateOptions({ velocity_min, velocity_max })
                  }
                />
                <div>
                  <label
                    className="block text-sm font-medium"
                    htmlFor="timing-precision"
                  >
                    Timing precision
                  </label>
                  <p className="mt-1 mb-3 text-xs leading-5 text-muted-foreground">
                    Higher values preserve shorter notes and finer timing.
                  </p>
                  <select
                    id="timing-precision"
                    value={options.smallest_unit}
                    disabled={busy}
                    onChange={(event) =>
                      void updateOptions({
                        smallest_unit: Number(event.target.value),
                      })
                    }
                    className="min-h-11 w-full rounded-xl border bg-background px-3 py-2 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:text-sm"
                  >
                    {[16, 32, 64, 128].map((precision) => (
                      <option key={precision} value={precision}>
                        1/{precision}
                      </option>
                    ))}
                  </select>
                </div>
                <OptionSlider
                  label="Chord grouping"
                  description="Controls how close notes must begin to be grouped as a chord."
                  value={String(options.min_gap_for_chord)}
                  values={[options.min_gap_for_chord]}
                  min={0}
                  max={16}
                  step={1}
                  disabled={busy}
                  onChange={([min_gap_for_chord]) =>
                    void updateOptions({ min_gap_for_chord })
                  }
                />
                <Button
                  variant="outline"
                  className="w-full"
                  disabled={!snapshot || busy}
                  onClick={() => setKeymapOpen(true)}
                >
                  <ArrowRightLeft className="size-4" aria-hidden="true" />
                  Remap notes
                </Button>
                <Button
                  variant="ghost"
                  className="w-full text-destructive"
                  disabled={busy}
                  onClick={() => void clearLocalData()}
                >
                  <Trash2 className="size-4" aria-hidden="true" /> Clear local
                  data
                </Button>
              </CardContent>
            </Card>
          </div>
        ) : (
          <Card className="grid min-h-[420px] place-items-center border-dashed bg-card/55 p-6 text-center">
            <div className="max-w-md">
              <div className="mx-auto grid size-16 place-items-center rounded-3xl bg-accent text-accent-foreground">
                <FileAudio className="size-7" aria-hidden="true" />
              </div>
              <h2 className="mt-5 font-heading text-xl font-bold tracking-tight">
                Your workspace is ready
              </h2>
              <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
                Choose a MIDI file to convert, edit, and preview it entirely in
                your browser.
              </p>
              <Button
                className="mt-6"
                size="lg"
                aria-label="Browse for a MIDI file"
                onClick={openMidiPicker}
                disabled={busy}
              >
                <FileUp className="size-4" aria-hidden="true" /> Choose MIDI
              </Button>
            </div>
          </Card>
        )}
      </section>

      <footer className="fixed inset-x-0 bottom-0 z-30 border-t bg-card/95 backdrop-blur-md">
        <div className="mx-auto grid max-w-[1440px] grid-cols-[auto_minmax(0,1fr)] items-center gap-3 px-4 py-2.5 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:px-6 lg:grid-cols-[auto_minmax(0,1fr)_auto_auto] lg:px-8">
          <div className="flex items-center gap-1">
            <Button
              size="icon"
              className="rounded-full"
              aria-label={playing ? 'Pause' : 'Play'}
              disabled={!snapshot || busy || playbackPending}
              onClick={() => void togglePlayback()}
            >
              {playing ? (
                <Pause className="size-4" aria-hidden="true" />
              ) : (
                <Play className="ml-0.5 size-4" aria-hidden="true" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Stop"
              disabled={!snapshot}
              onClick={stopPlayback}
            >
              <Square className="size-3.5" aria-hidden="true" />
            </Button>
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <span className="w-10 shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
              {formatTime(sliderPosition)}
            </span>
            <Slider
              className="w-full"
              value={[sliderPosition]}
              max={Math.max(duration, 1)}
              step={0.01}
              disabled={!snapshot || duration <= 0 || playbackPending}
              aria-label="Playback position"
              onValueChange={(next) =>
                queueSeek(typeof next === 'number' ? next : next[0])
              }
              onValueCommitted={(next) =>
                commitSeek(typeof next === 'number' ? next : next[0])
              }
            />
            <span className="hidden w-10 shrink-0 font-mono text-xs tabular-nums text-muted-foreground sm:inline">
              {formatTime(duration)}
            </span>
          </div>
          <div className="hidden items-center gap-2 sm:flex">
            <Volume2
              className="size-4 text-muted-foreground"
              aria-hidden="true"
            />
            <Slider
              className="w-24"
              value={[volume]}
              max={100}
              aria-label="Volume"
              onValueChange={(next) => {
                const value = typeof next === 'number' ? next : next[0];
                setVolume(value);
                player.current?.setVolume(value / 100);
              }}
            />
          </div>
          <span className="hidden rounded-full bg-secondary px-3 py-1.5 text-xs font-medium text-secondary-foreground lg:inline">
            {audioStatus === 'loading'
              ? 'Loading sounds'
              : audioStatus === 'soundfont'
                ? 'Studio instruments'
                : audioStatus === 'fallback'
                  ? 'Simple tones'
                  : 'Audio idle'}
          </span>
        </div>
      </footer>

      <Dialog open={keymapOpen} onOpenChange={setKeymapOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remap notes in track {activeTrack + 1}</DialogTitle>
            <DialogDescription>
              Map each original MIDI note number to its replacement. For
              example, 60 to 72 moves middle C up one octave.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={keymapText}
            onChange={(event) => setKeymapText(event.target.value)}
            className="min-h-48 font-mono"
            spellCheck={false}
            aria-label="Note mapping in JSON format"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setKeymapOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void applyKeymap()}>Apply</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}

function OptionSlider({
  label,
  description,
  value,
  values,
  min,
  max,
  step,
  disabled,
  onChange,
}: {
  label: string;
  description: string;
  value: string;
  values: number[];
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
  onChange: (values: number[]) => void;
}) {
  return (
    <div>
      <div className="flex justify-between gap-3 text-sm">
        <span className="font-medium">{label}</span>
        <span className="font-mono text-xs text-muted-foreground">{value}</span>
      </div>
      <p className="mt-1 mb-3 text-xs leading-5 text-muted-foreground">
        {description}
      </p>
      <Slider
        aria-label={`${label}. ${description}`}
        value={values}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onValueChange={(next) =>
          onChange(typeof next === 'number' ? [next] : Array.from(next))
        }
      />
    </div>
  );
}

function formatTime(seconds: number) {
  const whole = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`;
}
