<#
.SYNOPSIS
  Start the ResumeIQ backend (port 8000) and frontend (port 3000) for local development.

.DESCRIPTION
  Checks the environment variable *names* this stack reads. Values are never
  printed, and this script does not read .env files; the backend and Next.js
  load their own .env files when they start.

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

$repoRoot = Split-Path -Parent $PSScriptRoot
$backendDir = Join-Path $repoRoot "backend"
$frontendDir = Join-Path $repoRoot "frontend"

function Test-EnvName {
  param([Parameter(Mandatory = $true)][string]$Name)
  $item = Get-Item -LiteralPath "Env:$Name" -ErrorAction SilentlyContinue
  return $null -ne $item -and -not [string]::IsNullOrWhiteSpace([string]$item.Value)
}

function Write-EnvCheck {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [switch]$Required
  )
  if (Test-EnvName $Name) {
    Write-Host ("  [set]     {0}" -f $Name)
  } elseif ($Required) {
    Write-Host ("  [missing] {0}  (required in this shell)" -f $Name) -ForegroundColor Yellow
  } else {
    Write-Host ("  [missing] {0}  (optional here)" -f $Name) -ForegroundColor DarkYellow
  }
}

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
Write-Host "Environment variable names (values are not shown; .env files are not read here):"
Write-EnvCheck "SUPABASE_URL" -Required
Write-EnvCheck "SUPABASE_PUBLISHABLE_KEY" -Required
Write-EnvCheck "GROQ_API_KEY"
Write-EnvCheck "NVIDIA_API_KEY"
Write-EnvCheck "NEXT_PUBLIC_API_MODE"
Write-EnvCheck "NEXT_PUBLIC_API_BASE_URL"
Write-EnvCheck "NEXT_PUBLIC_SUPABASE_URL"
Write-EnvCheck "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"

$missing = @()
foreach ($name in @("SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY")) {
  if (-not (Test-EnvName $name)) { $missing += $name }
}
if (-not (Test-EnvName "GROQ_API_KEY") -and -not (Test-EnvName "NVIDIA_API_KEY")) {
  $missing += "GROQ_API_KEY or NVIDIA_API_KEY"
}
if ($missing.Count -gt 0) {
  Write-Host ""
  Write-Host ("Not set in this shell: {0}" -f ($missing -join ", ")) -ForegroundColor Yellow
  Write-Host "The backend reads backend/.env and Next reads frontend/.env.local if present."
  Write-Host "This script does not open those files; set the names in the shell to override them."
}

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
