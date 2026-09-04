[CmdletBinding()]
param(
    [string]$RepositoryRoot = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Assert-Condition {
    param(
        [Parameter(Mandatory)] [bool]$Condition,
        [Parameter(Mandatory)] [string]$Message
    )

    if (-not $Condition) {
        throw $Message
    }
}

function Get-BridgePosition {
    param([Parameter(Mandatory)] $Event)
    return [long]$Event.position_ticks
}

function Get-BridgePriority {
    param([Parameter(Mandatory)] $Event)
    if ($Event.type -eq "note") { return 1 }
    return 0
}

$fixtureDirectory = Join-Path $RepositoryRoot "fixtures/parity"
$assetDirectory = Join-Path $RepositoryRoot "assets"

Assert-Condition (Test-Path -LiteralPath $fixtureDirectory -PathType Container) `
    "Missing fixture directory: $fixtureDirectory"
Assert-Condition (Test-Path -LiteralPath $assetDirectory -PathType Container) `
    "Missing asset directory: $assetDirectory"

$fixtureFiles = @(Get-ChildItem -LiteralPath $fixtureDirectory -Filter "*.default.json" -File)
Assert-Condition ($fixtureFiles.Count -eq 1) `
    "Expected one default fixture, found $($fixtureFiles.Count)"

$verifiedTracks = 0
$verifiedEvents = 0

foreach ($fixtureFile in $fixtureFiles) {
    $fixture = Get-Content -LiteralPath $fixtureFile.FullName -Raw | ConvertFrom-Json
    $context = $fixtureFile.Name

    Assert-Condition ($fixture.schema_version -eq 1) "${context}: unsupported schema_version"
    Assert-Condition ($fixture.behavior_version -eq "rust-0.2.0-legacy") `
        "${context}: unexpected behavior_version"
    Assert-Condition ($null -ne $fixture.source.file) "${context}: missing source.file"
    $midiPath = Join-Path $assetDirectory ([string]$fixture.source.file)
    Assert-Condition (Test-Path -LiteralPath $midiPath -PathType Leaf) `
        "${context}: missing MIDI source $midiPath"

    $midiFile = Get-Item -LiteralPath $midiPath
    $actualHash = (Get-FileHash -LiteralPath $midiPath -Algorithm SHA256).Hash.ToLowerInvariant()
    Assert-Condition ($fixture.source.bytes -eq $midiFile.Length) `
        "${context}: fixture MIDI byte length is stale"
    Assert-Condition ([string]$fixture.source.sha256 -eq $actualHash) `
        "${context}: fixture checksum is stale"

    foreach ($property in @(
        "auto_boot_velocity", "auto_equalize_note_length", "velocity_min",
        "velocity_max", "min_gap_for_chord", "smallest_unit"
    )) {
        Assert-Condition ($null -ne $fixture.options.$property) `
            "${context}: missing option $property"
    }

    Assert-Condition ($fixture.ppq -gt 0) "${context}: ppq must be positive"
    Assert-Condition ($fixture.track_count -eq $fixture.tracks.Count) `
        "${context}: track_count does not match tracks array"

    for ($trackIndex = 0; $trackIndex -lt $fixture.tracks.Count; $trackIndex++) {
        $track = $fixture.tracks[$trackIndex]
        $trackContext = "$context track $trackIndex"
        Assert-Condition ($track.index -eq $trackIndex) "${trackContext}: non-contiguous index"
        Assert-Condition ($null -ne $track.name) "${trackContext}: missing name"
        Assert-Condition ($null -ne $track.instrument.name) "${trackContext}: missing instrument name"
        Assert-Condition ($track.mml -notmatch "\s") "${trackContext}: rendered MML contains whitespace"

        $previousPosition = -1L
        $previousPriority = -1
        foreach ($event in $track.bridge_events) {
            Assert-Condition ($event.type -in @("note", "tempo", "program_change")) `
                "${trackContext}: unknown bridge event type $($event.type)"
            $position = Get-BridgePosition $event
            $priority = Get-BridgePriority $event
            Assert-Condition ($position -ge $previousPosition) `
                "${trackContext}: bridge events are not sorted by position"
            if ($position -eq $previousPosition) {
                Assert-Condition ($priority -ge $previousPriority) `
                    "${trackContext}: note precedes metadata at the same tick"
            }
            else {
                $previousPriority = -1
            }
            $previousPosition = $position
            $previousPriority = $priority
        }

        $cursor = 0L
        $noteLength = 0L
        $previousType = $null
        $chordRootDuration = $null
        $chordConnectorPending = $false

        for ($eventIndex = 0; $eventIndex -lt $track.mml_events.Count; $eventIndex++) {
            $event = $track.mml_events[$eventIndex]
            $eventContext = "$trackContext event $eventIndex"
            Assert-Condition ($event.type -in @(
                "note", "rest", "tempo", "octave", "octave_up", "octave_down",
                "chord", "velocity", "note_length"
            )) "${eventContext}: unknown MML event type $($event.type)"

            switch ($event.type) {
                "rest" {
                    Assert-Condition ($event.duration_units -gt 0) `
                        "${eventContext}: rest duration must be positive"
                    $cursor += [long]$event.duration_units
                }
                "tempo" {
                    Assert-Condition ($event.position_units -eq $cursor) `
                        "${eventContext}: tempo position differs from sequential position"
                    Assert-Condition ($previousType -ne "tempo") `
                        "${eventContext}: adjacent tempo events survived normalization"
                }
                "note" {
                    Assert-Condition ($event.duration_units -gt 0) `
                        "${eventContext}: note duration must be positive"
                    Assert-Condition ($event.mml_note_length -eq ([string]$event.mml).Split("&").Count) `
                        "${eventContext}: note length differs from rendered ties"
                    $noteLength += [long]$event.mml_note_length

                    if ($event.is_chord_member) {
                        Assert-Condition $chordConnectorPending `
                            "${eventContext}: chord member has no pending chord connector"
                        Assert-Condition ($null -ne $chordRootDuration) `
                            "${eventContext}: chord member has no root note"
                        Assert-Condition ($event.duration_units -eq $chordRootDuration) `
                            "${eventContext}: chord duration differs from root note"
                        $chordConnectorPending = $false
                    }
                    else {
                        Assert-Condition ($event.position_units -eq $cursor) `
                            "${eventContext}: note position differs from sequential position"
                        $cursor += [long]$event.duration_units
                        $chordRootDuration = [long]$event.duration_units
                    }
                }
                "chord" {
                    Assert-Condition ($previousType -eq "note") `
                        "${eventContext}: chord connector does not follow a note"
                    $chordConnectorPending = $true
                }
            }

            $previousType = [string]$event.type
            $verifiedEvents++
        }

        Assert-Condition ($track.mml_note_length -eq $noteLength) `
            "${trackContext}: aggregate mml_note_length is incorrect"
        $verifiedTracks++
    }
}

Write-Output (
    "Parity fixtures verified: {0} files, {1} tracks, {2} MML events." -f `
        $fixtureFiles.Count, $verifiedTracks, $verifiedEvents
)
