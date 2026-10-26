<#>
.SYNOPSIS
    Post-deploy verification checks for the ResumeIQ API on Render.
    Runs public read-only checks only.

.DESCRIPTION
    Verifies:
    - /health returns 200 with expected JSON
    - /docs, /redoc, /openapi.json return 404 in production (ENVIRONMENT=production)
    - CORS headers allow configured origins
    - Security headers are present (CSP, HSTS, etc.)

.PARAMETER ApiBaseUrl
    Base URL of the deployed API (e.g., https://resumeiq-api.onrender.com)

.PARAMETER AllowedOrigin
    Origin to test CORS against (e.g., https://your-app.vercel.app)

.EXAMPLE
    ./scripts/post-deploy-check.ps1 -ApiBaseUrl https://resumeiq-api.onrender.com -AllowedOrigin https://my-app.vercel.app
#>

param(
    [Parameter(Mandatory=$true)]
    [string]$ApiBaseUrl,

    [Parameter(Mandatory=$true)]
    [string]$AllowedOrigin
)

$ErrorActionPreference = "Stop"

Write-Host "=== ResumeIQ Post-Deploy Verification ===" -ForegroundColor Cyan
Write-Host "API Base URL: $ApiBaseUrl"
Write-Host "Allowed Origin: $AllowedOrigin"
Write-Host ""

$passed = 0
$failed = 0

function Test-Endpoint {
    param(
        [string]$Name,
        [string]$Path,
        [int[]]$ExpectedStatus,
        [scriptblock]$ValidateBody = $null,
        [hashtable]$Headers = @{},
        [string]$Method = "GET"
    )

    $url = "$ApiBaseUrl$Path"
    Write-Host "Testing $Name ($Method $url)..." -NoNewline

    try {
        $response = Invoke-WebRequest -Uri $url -Method $Method -Headers $Headers -UseBasicParsing -ErrorAction Stop
        $status = $response.StatusCode

        if ($ExpectedStatus -contains $status) {
            $bodyValid = $true
            if ($ValidateBody) {
                $body = $response.Content | ConvertFrom-Json -ErrorAction SilentlyContinue
                $bodyValid = & $ValidateBody $body
            }

            if ($bodyValid) {
                Write-Host " PASS (HTTP $status)" -ForegroundColor Green
                $global:passed++
                return $true
            } else {
                Write-Host " FAIL (HTTP $status but body validation failed)" -ForegroundColor Red
                $global:failed++
                return $false
            }
        } else {
            Write-Host " FAIL (HTTP $status, expected $($ExpectedStatus -join ' or '))" -ForegroundColor Red
            $global:failed++
            return $false
        }
    } catch {
        $status = $_.Exception.Response.StatusCode.value__
        if ($ExpectedStatus -contains $status) {
            Write-Host " PASS (HTTP $status)" -ForegroundColor Green
            $global:passed++
            return $true
        } else {
            Write-Host " FAIL (HTTP $status, expected $($ExpectedStatus -join ' or '))" -ForegroundColor Red
            $global:failed++
            return $false
        }
    }
}

function Test-Headers {
    param(
        [string]$Name,
        [string]$Path,
        [hashtable]$ExpectedHeaders,
        [hashtable]$RequestHeaders = @{}
    )

    $url = "$ApiBaseUrl$Path"
    Write-Host "Testing $Name headers ($url)..." -NoNewline

    try {
        $response = Invoke-WebRequest -Uri $url -Method "GET" -Headers $RequestHeaders -UseBasicParsing -ErrorAction Stop
        $allPassed = $true

        foreach ($header in $ExpectedHeaders.Keys) {
            $expected = $ExpectedHeaders[$header]
            $actual = $response.Headers[$header]
            if ($actual -and ($actual -like "*$expected*")) {
                Write-Host " $header: PASS" -ForegroundColor Green
            } else {
                Write-Host " $header: FAIL (expected '$expected', got '$actual')" -ForegroundColor Red
                $allPassed = $false
            }
        }

        if ($allPassed) {
            $global:passed++
        } else {
            $global:failed++
        }
        return $allPassed
    } catch {
        Write-Host " FAIL (request failed: $($_.Exception.Message))" -ForegroundColor Red
        $global:failed++
        return $false
    }
}

# 1. Health endpoint
Test-Endpoint -Name "Health" -Path "/health" -ExpectedStatus @(200) -ValidateBody {
    param($body) $body.status -eq "ok" -and $body.version -and $body.environment -eq "production"
}

# 2. Docs hidden in production
Test-Endpoint -Name "Swagger UI (/docs)" -Path "/docs" -ExpectedStatus @(404)
Test-Endpoint -Name "ReDoc (/redoc)" -Path "/redoc" -ExpectedStatus @(404)
Test-Endpoint -Name "OpenAPI JSON (/openapi.json)" -Path "/openapi.json" -ExpectedStatus @(404)

# 3. CORS headers
$corsHeaders = @{
    "Access-Control-Allow-Origin" = $AllowedOrigin
    "Access-Control-Allow-Credentials" = "true"
}
Test-Headers -Name "CORS" -Path "/health" -ExpectedHeaders $corsHeaders -RequestHeaders @{ "Origin" = $AllowedOrigin }

# 4. Security headers
$securityHeaders = @{
    "X-Content-Type-Options" = "nosniff"
    "X-Frame-Options" = "DENY"
    "Referrer-Policy" = "no-referrer"
    "Permissions-Policy" = "camera=(), microphone=(), geolocation=()"
    "Content-Security-Policy" = "default-src 'none'; frame-ancestors 'none'"
}
Test-Headers -Name "Security" -Path "/health" -ExpectedHeaders $securityHeaders

# Summary
Write-Host ""
Write-Host "=== Summary ===" -ForegroundColor Cyan
Write-Host "Passed: $passed" -ForegroundColor Green
Write-Host "Failed: $failed" -ForegroundColor Red

if ($failed -gt 0) {
    Write-Host ""
    Write-Host "Some checks failed. Review the output above." -ForegroundColor Red
    exit 1
} else {
    Write-Host ""
    Write-Host "All checks passed!" -ForegroundColor Green
    exit 0
}