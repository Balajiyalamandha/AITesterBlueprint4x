# Starts everything QABuddyAI needs on Windows. Ctrl+C stops the servers it started.
#
# Mirrors chapter 10's run.ps1: ollama + an embedding model, the FastAPI backend on
# :8101, and the Vite dev server on :5191. Run from anywhere:
#   powershell -ExecutionPolicy Bypass -File run.ps1

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$VenvPython = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'
# 127.0.0.1, not localhost: on Windows the name hits ::1 first and each probe waits ~2s.
$OllamaUrl = 'http://127.0.0.1:11434'
$Models = @('qwen3-embedding:0.6b', 'bge-m3', 'nomic-embed-text')

function Test-Ollama {
    try { Invoke-WebRequest -Uri "$OllamaUrl/api/tags" -UseBasicParsing -TimeoutSec 5 | Out-Null; return $true }
    catch { return $false }
}

# -- ollama ---------------------------------------------------------------
if (-not (Test-Ollama)) {
    Write-Host 'starting ollama...'
    Start-Process -FilePath 'ollama' -ArgumentList 'serve' -WindowStyle Hidden
    $ok = $false
    foreach ($i in 1..20) { Start-Sleep -Milliseconds 500; if (Test-Ollama) { $ok = $true; break } }
    if (-not $ok) { throw 'ollama did not start. Launch the Ollama app and retry.' }
}

# Prefer the best model, fall back gracefully. The app also auto-picks at runtime,
# so a failed pull is not fatal.
$installed = ollama list
$haveModel = $false
foreach ($m in $Models) { if ($installed -match [regex]::Escape($m)) { $haveModel = $true; break } }
if (-not $haveModel) {
    Write-Host "no preferred embedding model found; trying $($Models[0]) (one-time download)..."
    try { ollama pull $Models[0] } catch { Write-Host "pull failed; falling back to nomic-embed-text"; ollama pull 'nomic-embed-text' }
}

# -- python ---------------------------------------------------------------
if (-not (Test-Path $VenvPython)) {
    Write-Host 'creating .venv...'
    python -m venv .venv
}

Write-Host 'installing backend deps...'
& $VenvPython -m pip install --quiet -r requirements.txt

# -- backend --------------------------------------------------------------
Write-Host 'backend  -> http://localhost:8101'
$backend = Start-Process -FilePath $VenvPython `
    -ArgumentList '-m', 'uvicorn', 'server.app:app', '--port', '8101' `
    -PassThru -NoNewWindow

# -- frontend -------------------------------------------------------------
if (-not (Test-Path 'ui\node_modules\.bin\vite.cmd')) {
    Write-Host 'installing ui deps...'
    Push-Location ui
    # --include=dev overrides a global NODE_ENV=production, which would skip vite entirely.
    npm install --include=dev
    Pop-Location
}

Write-Host 'frontend -> http://localhost:5191'
try {
    Push-Location ui
    npm run dev
} finally {
    Pop-Location
    if ($backend -and -not $backend.HasExited) {
        Write-Host 'stopping backend...'
        Stop-Process -Id $backend.Id -Force
    }
}
