# Starts everything the RAG Explorer needs on Windows. Ctrl+C stops both servers.
#
# Mirrors run.sh: ollama + nomic-embed-text, the FastAPI backend on :8100, and the
# Vite dev server on :5190. Run from anywhere: powershell -File run.ps1

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$VenvPython = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'
# 127.0.0.1, not localhost: on Windows the name hits ::1 first and each probe
# waits ~2s for that to fail before trying IPv4.
$OllamaUrl = 'http://127.0.0.1:11434'

# -- ollama ---------------------------------------------------------------
function Test-Ollama {
    try {
        Invoke-WebRequest -Uri "$OllamaUrl/api/tags" -UseBasicParsing -TimeoutSec 5 | Out-Null
        return $true
    } catch {
        return $false
    }
}

if (-not (Test-Ollama)) {
    Write-Host 'starting ollama...'
    Start-Process -FilePath 'ollama' -ArgumentList 'serve' -WindowStyle Hidden
    $ok = $false
    foreach ($i in 1..20) {
        Start-Sleep -Milliseconds 500
        if (Test-Ollama) { $ok = $true; break }
    }
    if (-not $ok) { throw 'ollama did not start. Launch the Ollama app and retry.' }
}

if ((ollama list) -notmatch 'nomic-embed-text') {
    Write-Host 'pulling nomic-embed-text (274 MB, one time)...'
    ollama pull nomic-embed-text
}

# -- python ---------------------------------------------------------------
if (-not (Test-Path $VenvPython)) {
    Write-Host 'creating .venv...'
    python -m venv .venv
}

Write-Host 'installing backend deps...'
& $VenvPython -m pip install --quiet fastapi uvicorn pypdf chromadb python-dotenv httpx

# -- backend --------------------------------------------------------------
Write-Host 'backend  -> http://localhost:8100'
$backend = Start-Process -FilePath $VenvPython `
    -ArgumentList '-m', 'uvicorn', 'server.app:app', '--port', '8100' `
    -PassThru -NoNewWindow

# -- frontend -------------------------------------------------------------
if (-not (Test-Path 'ui\node_modules\.bin\vite.cmd')) {
    Write-Host 'installing ui deps...'
    Push-Location ui
    # --include=dev overrides a global NODE_ENV=production, which would otherwise
    # silently skip vite (a devDependency) and leave `npm run dev` with nothing to run.
    npm install --include=dev
    Pop-Location
}

Write-Host 'frontend -> http://localhost:5190'
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
