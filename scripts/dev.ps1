<#
.SYNOPSIS
  Start the ResumeIQ backend (port 8000) and frontend (port 3000) for local development.

.DESCRIPTION
  Checks the environment variable *names* this stack reads. Values are never
  printed, and this script does not read .env files for values; the backend and
  Next.js load their own .env files when they start.

  Reports three states per variable name:
    - "set in shell"                 — the name has a non-empty value in this shell
    - "not in shell (the app reads it from its .env file)" — not in shell, but
      found in the app's .env file (backend/.env or frontend/.env.local)
    - "defined in backend/.env" / "defined in frontend/.env.local" — the name
      appears at a line start in the respective .env file (key=...), detected
      without reading any values.

  Stops with a clear error only when a REQUIRED name is defined nowhere (not in
  shell, not in the app's .env file).

  Starts FastAPI and Next.js in two PowerShell windows, waits for the backend
  /health endpoint, then prints the localhost URLs to open. Both servers bind
  to 127.0.0.1; no LAN address is printed or bound.

.PARAMETER CheckOnly
  Run the environment and port checks, print what would start, and exit without
  opening windows.
#>
[CmdletBinding()]
param(
  [switch]$CheckOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot   = Split-Path -Parent $PSScriptRoot
$backendDir = Join-Path $repoRoot "backend"
$frontendDir = Join-Path $repoRoot "frontend"

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

# At least one AI key is required for the backend to do AI calls
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

Write-Host "ResumeIQ dev launcher"
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
# AI keys: at least one must be present somewhere
$aiKeyFound = $false
foreach ($name in $backendAiKeys) {
  $s = Get-VarStatus $name "backend"
  if ($s.Source -ne "none") { $aiKeyFound = $true; break }
}
if (-not $aiKeyFound) {
  $missingRequired += "backend/GROQ_API_KEY or NVIDIA_API_KEY (at least one required for AI calls)"
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
foreach ($tool in @("uv", "npm", "powershell.exe")) {
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

$backendCommand = "`$host.UI.RawUI.WindowTitle = 'ResumeIQ backend (8000)'; Set-Location -LiteralPath '$backendDir'; uv run uvicorn app.main:app --host 127.0.0.1 --port 8000 --log-level info"
$frontendCommand = "`$host.UI.RawUI.WindowTitle = 'ResumeIQ frontend (3000)'; Set-Location -LiteralPath '$frontendDir'; npm run dev -- --hostname localhost --port 3000"

if ($CheckOnly) {
  Write-Host ""
  Write-Host "Check-only: would start these in two windows:"
  Write-Host ("  backend:  {0}" -f $backendCommand)
  Write-Host ("  frontend: {0}" -f $frontendCommand)
  Write-Host "Check-only: no servers started."
  exit 0
}

Write-Host ""
Write-Host "Starting two windows..."
Start-Process -FilePath "powershell.exe" -ArgumentList @("-NoExit", "-Command", $backendCommand) -WorkingDirectory $backendDir
Start-Process -FilePath "powershell.exe" -ArgumentList @("-NoExit", "-Command", $frontendCommand) -WorkingDirectory $frontendDir

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