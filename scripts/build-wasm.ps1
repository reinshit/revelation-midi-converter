[CmdletBinding()]
param(
    [string]$RepositoryRoot = (Split-Path -Parent $PSScriptRoot),
    [string]$Toolchain = "nightly-x86_64-pc-windows-gnu"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$cargo = Join-Path $env:USERPROFILE ".cargo/bin/cargo.exe"
$wasmBindgen = Join-Path $env:USERPROFILE ".cargo/bin/wasm-bindgen.exe"
$wasmTarget = "wasm32-unknown-unknown"
$input = Join-Path $RepositoryRoot "target/$wasmTarget/release/reve_midi_wasm.wasm"
$output = Join-Path $RepositoryRoot "web/lib/wasm/pkg"

foreach ($tool in @($cargo, $wasmBindgen)) {
    if (-not (Test-Path -LiteralPath $tool -PathType Leaf)) {
        throw "Required tool not found: $tool"
    }
}

& $cargo "+$Toolchain" build -p reve-midi-wasm --release --target $wasmTarget
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

New-Item -ItemType Directory -Path $output -Force | Out-Null
& $wasmBindgen $input --target web --typescript --out-dir $output --out-name reve_midi_wasm
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$wasm = Get-Item -LiteralPath (Join-Path $output "reve_midi_wasm_bg.wasm")
Write-Output ("Browser WASM package built: {0} bytes" -f $wasm.Length)

