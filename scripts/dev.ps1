<#
.SYNOPSIS
  Start the ResumeIQ backend (port 8000) and frontend (port 3000) for local development.

.DESCRIPTION
  This is a thin wrapper around scripts/dev.mjs (the Node.js launcher).
  It performs the same environment and port checks, then delegates to dev.mjs.
  Windows opened by this script use -NoExit so they stay open on error.
  Automatically runs "uv sync --frozen" in backend and "npm ci" in frontend
  when lock files are newer than the installed state.
  If the frontend fails to start once, deletes frontend/.next and retries once.

.PARAMETER CheckOnly
  Run the environment and port checks, print what would start, and exit without
  opening windows.

.PARAMETER NoWrapper
  Run the Node.js launcher directly without this wrapper's extra checks.
#>
[CmdletBinding()]
param(
  [switch]$CheckOnly,
  [switch]$NoWrapper
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot   = Split-Path -Parent $PSScriptRoot
$backendDir = Join-Path $repoRoot "backend"
$frontendDir = Join-Path $repoRoot "frontend"
$devMjs     = Join-Path (Join-Path $repoRoot "scripts") "dev.mjs"

$backendEnvPath  = Join-Path $backendDir  ".env"
$frontendEnvPath = Join-Path $frontendDir ".env.local"

# --- Helper: check if a name has a non-empty value in the current shell ---
function Test-NameInShell {
  param([Parameter(Mandatory = $true)][string]$Name)
  $val = [Environment]::GetEnvironmentVariable($Name, "Process")
  return $null -ne $val -and $val.Trim() -ne ""
}

# --- Helper: check if a name appears as key=... at line start in a .env file ---
function Test-NameInEnvFile {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$EnvFilePath
  )
  if (-not (Test-Path -LiteralPath $EnvFilePath)) { return $false }
  try {
    $lines = Get-Content -LiteralPath $EnvFilePath -Raw -ErrorAction Stop
  } catch { return $false }
  foreach ($raw in $lines -split "`r?`n") {
    $line = $raw.Trim()
    if (-not $line -or $line.StartsWith("#")) { continue }
    if ($line -match "^$([regex]::Escape($Name))=") { return $true }
  }
  return $false
}

# --- Helper: produce the three-state status string for a variable ---
function Get-VarStatus {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$App,         # "backend" or "frontend"
    [switch]$Required
  )

  $envFile = if ($App -eq "backend") { $backendEnvPath } else { $frontendEnvPath }
  $inShell = Test-NameInShell $Name
  $inFile  = Test-NameInEnvFile $Name $envFile

  if ($inShell) {
    return @{ Status = "set in shell"; Source = "shell" }
  } elseif ($inFile) {
    return @{ Status = "not in shell (the app reads it from its .env file)"; Source = "file" }
  } elseif ($Required) {
    return @{ Status = "missing everywhere (required)"; Source = "none" }
  } else {
    return @{ Status = "not in shell (the app reads it from its .env file)"; Source = "none" }
  }
}

# --- Helper: print a single variable's status ---
function Write-VarStatus {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$App,
    [switch]$Required
  )
  $s = Get-VarStatus $Name $App -Required:$Required
  $label = "  [{0}] {1}" -f $s.Status, $Name
  if ($s.Source -eq "shell")       { Write-Host $label -ForegroundColor Green }
  elseif ($s.Source -eq "file")    { Write-Host $label -ForegroundColor Cyan }
  elseif ($s.Source -eq "none" -and $Required) { Write-Host $label -ForegroundColor Red }
  else                             { Write-Host $label -ForegroundColor DarkYellow }
}

# --- Required variable lists per app ---
$backendRequired  = @("SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY")
$frontendRequired = @()

# AI provider keys (optional): if none is defined anywhere, AI features are off
# but deterministic features still work. This does NOT stop the script.
$backendAiKeys = @("GROQ_API_KEY", "NVIDIA_API_KEY")

# --- Port check ---
function Test-PortInUse {
  param([Parameter(Mandatory = $true)][int]$Port)
  $client = [System.Net.Sockets.TcpClient]::new()
  try {
    $client.Connect("127.0.0.1", $Port)
    return $true
  } catch {
    return $false
  } finally {
    $client.Dispose()
  }
}

Write-Host "ResumeIQ dev launcher (PowerShell wrapper)"
Write-Host "Repository: $repoRoot"
Write-Host ""

Write-Host "Backend environment variable names (values are never shown; .env files are not read for values):"
Write-VarStatus "SUPABASE_URL" "backend" -Required
Write-VarStatus "SUPABASE_PUBLISHABLE_KEY" "backend" -Required
Write-VarStatus "GROQ_API_KEY" "backend"
Write-VarStatus "NVIDIA_API_KEY" "backend"
Write-VarStatus "NEXT_PUBLIC_API_MODE" "backend"
Write-VarStatus "NEXT_PUBLIC_API_BASE_URL" "backend"
Write-VarStatus "NEXT_PUBLIC_SUPABASE_URL" "backend"
Write-VarStatus "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY" "backend"

Write-Host ""
Write-Host "Frontend environment variable names (values are never shown; .env files are not read for values):"
Write-VarStatus "NEXT_PUBLIC_API_MODE" "frontend"
Write-VarStatus "NEXT_PUBLIC_API_BASE_URL" "frontend"
Write-VarStatus "NEXT_PUBLIC_SUPABASE_URL" "frontend"
Write-VarStatus "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY" "frontend"

# --- Required-variable validation (stop with error only when defined nowhere) ---
$missingRequired = @()

foreach ($name in $backendRequired) {
  $s = Get-VarStatus $name "backend" -Required
  if ($s.Source -eq "none") { $missingRequired += "backend/$name" }
}
# AI keys: optional — if none found, print a note but do NOT exit with error
$aiKeyFound = $false
foreach ($name in $backendAiKeys) {
  $s = Get-VarStatus $name "backend"
  if ($s.Source -ne "none") { $aiKeyFound = $true; break }
}
if (-not $aiKeyFound) {
  Write-Host ""
  Write-Host "Note: AI features are off: no provider key found; deterministic features still work." -ForegroundColor Yellow
}

if ($missingRequired.Count -gt 0) {
  Write-Host ""
  Write-Host "ERROR: Required variable(s) defined nowhere (not in shell, not in backend/.env, not in frontend/.env.local):" -ForegroundColor Red
  foreach ($m in $missingRequired) { Write-Host "  $m" -ForegroundColor Red }
  Write-Host ""
  Write-Host "Fix: set the name in your shell, or add it to the appropriate .env file." -ForegroundColor Yellow
  exit 1
}

# --- Tooling checks ---
foreach ($tool in @("uv", "npm", "node", "powershell.exe")) {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
    Write-Host ("Required tool not found on PATH: {0}" -f $tool) -ForegroundColor Red
    exit 1
  }
}

if (-not (Test-Path -LiteralPath (Join-Path $backendDir "pyproject.toml"))) {
  Write-Host ("Backend folder not found: {0}" -f $backendDir) -ForegroundColor Red
  exit 1
}
if (-not (Test-Path -LiteralPath (Join-Path $frontendDir "package.json"))) {
  Write-Host ("Frontend folder not found: {0}" -f $frontendDir) -ForegroundColor Red
  exit 1
}

foreach ($port in @(8000, 3000)) {
  if (Test-PortInUse $port) {
    Write-Host ("Port {0} is already in use. Stop that process before starting the stack." -f $port) -ForegroundColor Red
    exit 1
  }
}
Write-Host ""
Write-Host "Ports 8000 and 3000 are free."

if ($NoWrapper) {
  Write-Host ""
  Write-Host "Running Node.js launcher directly..."
  $args = @("dev.mjs")
  if ($CheckOnly) { $args += "--check-only" }
  Start-Process -FilePath "node" -ArgumentList $args -WorkingDirectory $repoRoot -NoNewWindow -Wait
  exit $LASTEXITCODE
}

# --- Auto-sync dependencies (compare timestamps) ---
function Test-LockNewer {
  param([string]$LockPath, [string]$InstallPath)
  if (-not (Test-Path -LiteralPath $LockPath)) { return $false }
  if (-not (Test-Path -LiteralPath $InstallPath)) { return $true }
  $lockTime  = (Get-Item -LiteralPath $LockPath).LastWriteTimeUtc
  $installTime = (Get-Item -LiteralPath $InstallPath).LastWriteTimeUtc
  return $lockTime -gt $installTime
}

# Backend: uv sync --frozen if uv.lock newer than .venv
$backendLock  = Join-Path $backendDir "uv.lock"
$backendVenv  = Join-Path $backendDir ".venv"
if (Test-LockNewer $backendLock $backendVenv) {
  Write-Host ""
  Write-Host "Backend dependencies outdated (uv.lock newer than .venv). Running: uv sync --frozen" -ForegroundColor Cyan
  $result = Start-Process -FilePath "uv" -ArgumentList "sync", "--frozen" -WorkingDirectory $backendDir -Wait -PassThru -NoNewWindow
  if ($result.ExitCode -ne 0) {
    Write-Host "uv sync --frozen failed with exit code $($result.ExitCode)" -ForegroundColor Red
    exit $result.ExitCode
  }
  Write-Host "Backend dependencies synced." -ForegroundColor Green
}

# Frontend: npm ci if package-lock.json newer than node_modules
$frontendLock    = Join-Path $frontendDir "package-lock.json"
$frontendModules = Join-Path $frontendDir "node_modules"
if (Test-LockNewer $frontendLock $frontendModules) {
  Write-Host ""
  Write-Host "Frontend dependencies outdated (package-lock.json newer than node_modules). Running: npm ci" -ForegroundColor Cyan
  $npmCmd = if ([Environment]::OSVersion.Platform -eq 'Win32NT') { "npm.cmd" } else { "npm" }
  $result = Start-Process -FilePath $npmCmd -ArgumentList "ci" -WorkingDirectory $frontendDir -Wait -PassThru -NoNewWindow
  if ($result.ExitCode -ne 0) {
    Write-Host "npm ci failed with exit code $($result.ExitCode)" -ForegroundColor Red
    exit $result.ExitCode
  }
  Write-Host "Frontend dependencies installed." -ForegroundColor Green
}

# Check-only mode: exit after checks and dependency sync
if ($CheckOnly) {
  Write-Host ""
  Write-Host "Check-only mode: would start backend and frontend." -ForegroundColor Green
  Write-Host "  backend:  uv run uvicorn app.main:app --host 127.0.0.1 --port 8000 --log-level info"
  Write-Host "  frontend: npm run dev -- --hostname localhost --port 3000"
  Write-Host "Check-only: no servers started." -ForegroundColor Green
  exit 0
}

# --- Launch the Node.js dev launcher in two separate windows with -NoExit ---
Write-Host ""
Write-Host "Starting backend and frontend in separate windows..." -ForegroundColor Green

$nodeArgs = @("dev.mjs")
if ($CheckOnly) { $nodeArgs += "--check-only" }

# Backend window
$backendTitle = "ResumeIQ backend (8000)"
Start-Process -FilePath "powershell.exe" -ArgumentList @(
  "-NoExit",
  "-Command",
  "Set-Location -LiteralPath '$repoRoot'; node dev.mjs --backend-only"
) -WorkingDirectory $backendDir

# Frontend window (with retry logic for .next deletion)
$frontendTitle = "ResumeIQ frontend (3000)"
$frontendScript = @"
  `$repoRoot = '$repoRoot'
  `$frontendDir = '$frontendDir'
  `$maxRetries = 1
  `$attempt = 0
  while (`$attempt -le `$maxRetries) {
    `$result = Start-Process -FilePath 'node' -ArgumentList 'dev.mjs', '--frontend-only' -WorkingDirectory `$repoRoot -Wait -PassThru -NoNewWindow
    if (`$result.ExitCode -eq 0) { exit 0 }
    Write-Host 'Frontend failed (exit code: ' + `$result.ExitCode + ').'
    if (`$attempt -lt `$maxRetries) {
      Write-Host 'Deleting frontend/.next and retrying...' -ForegroundColor Yellow
      Remove-Item -LiteralPath (Join-Path `$frontendDir '.next') -Recurse -Force -ErrorAction SilentlyContinue
      `$attempt++
    } else {
      Write-Host 'Frontend failed after retry. Window stays open for inspection.' -ForegroundColor Red
      exit `$result.ExitCode
    }
  }
"@
Start-Process -FilePath "powershell.exe" -ArgumentList @(
  "-NoExit",
  "-Command",
  $frontendScript
) -WorkingDirectory $frontendDir

# Wait for backend health (in this window)
Write-Host ""
Write-Host "Waiting for http://127.0.0.1:8000/health ..."
$healthy = $false
for ($attempt = 1; $attempt -le 60; $attempt++) {
  try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:8000/health" -TimeoutSec 2
    if ($health.status -eq "ok") {
      $healthy = $true
      break
    }
  } catch {
    Start-Sleep -Seconds 1
  }
}

if (-not $healthy) {
  Write-Host "Backend did not report healthy within 60 seconds. Check the backend window." -ForegroundColor Red
  exit 1
}

Write-Host "Backend is healthy (status=ok)." -ForegroundColor Green
Write-Host ""
Write-Host "Open:"
Write-Host "  App:    http://localhost:3000"
Write-Host "  API:    http://localhost:8000/docs"
Write-Host "  Health: http://localhost:8000/health"
Write-Host ""
Write-Host "Both servers are bound to localhost/127.0.0.1. Close the two windows to stop them."