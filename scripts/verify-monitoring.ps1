# Verifies the InsightHub monitoring endpoints (PowerShell 5.1+). Mirror of verify-monitoring.sh.
#   -BaseUrl             default http://localhost:5000
#   -Token               default: $env:METRICS_TOKEN, else read from backend\.env
#   -StorageFailureTest  start a throwaway backend (port 5099, temp DATA_DIR), delete the dir, expect 503
#   -ChromaContainer     docker stop/start that container and expect 503 then 200
#   -CheckPort8000       show docker compose ps / docker port (needs docker)
param(
  [string]$BaseUrl = 'http://localhost:5000',
  [string]$Token = $env:METRICS_TOKEN,
  [switch]$StorageFailureTest,
  [string]$ChromaContainer = '',
  [switch]$CheckPort8000
)
$root = Split-Path -Parent $PSScriptRoot
if (-not $Token -and (Test-Path "$root\backend\.env")) {
  $line = Get-Content "$root\backend\.env" | Where-Object { $_ -match '^METRICS_TOKEN=' } | Select-Object -First 1
  if ($line) { $Token = ($line -replace '^METRICS_TOKEN=', '').Trim() }
}
if (-not $Token) { Write-Host 'METRICS_TOKEN not set'; exit 2 }
$ExpectedHealth = '{"status":"ok","message":"InsightHub Backend & Vector Gateway is running."}'
$script:Fail = $false
function Pass($m) { Write-Host "  PASS: $m" }
function Bad($m)  { Write-Host "  FAIL: $m"; $script:Fail = $true }

# Returns @{ Code; Body } and never throws on non-2xx.
function Get-Http([string]$Url, [string]$Bearer) {
  $h = @{}; if ($Bearer) { $h['Authorization'] = "Bearer $Bearer" }
  try {
    $r = Invoke-WebRequest -Uri $Url -Headers $h -UseBasicParsing -TimeoutSec 15
    return @{ Code = [int]$r.StatusCode; Body = $r.Content }
  } catch {
    $resp = $_.Exception.Response
    if ($resp) {
      $body = ''
      try { $body = (New-Object System.IO.StreamReader($resp.GetResponseStream())).ReadToEnd() } catch {}
      return @{ Code = [int]$resp.StatusCode; Body = $body }
    }
    return @{ Code = 0; Body = $_.Exception.Message }
  }
}
function Expect-Code($label, $want, $url, $bearer) {
  $r = Get-Http $url $bearer
  if ($r.Code -eq $want) { Pass "$label -> $($r.Code)" } else { Bad "$label -> $($r.Code) (want $want)" }
  return $r
}
function Get-Metric($name) {
  $m = (Get-Http "$BaseUrl/metrics" $Token).Body
  $sum = 0.0
  foreach ($l in ($m -split "`n")) {
    if ($l -match "^$name(\{[^}]*\})?\s+([0-9eE+.\-]+)") { $sum += [double]::Parse($Matches[2], [Globalization.CultureInfo]::InvariantCulture) }
  }
  return $sum
}

Write-Host '== 1. /api/health unchanged'
$r = Get-Http "$BaseUrl/api/health" $null; Write-Host "  $($r.Body)"
if ($r.Body.Trim() -eq $ExpectedHealth) { Pass 'same response as recorded' } else { Bad 'response differs' }

Write-Host '== 2. /metrics auth'
Expect-Code 'no token' 401 "$BaseUrl/metrics" $null | Out-Null
Expect-Code 'wrong token' 401 "$BaseUrl/metrics" 'wrong-token' | Out-Null
Expect-Code 'correct token' 200 "$BaseUrl/metrics" $Token | Out-Null

Write-Host '== 3. counters move after traffic'
$s0 = Get-Metric 'insighthub_http_requests_success_total'; $f0 = Get-Metric 'insighthub_http_requests_failed_total'; $t0 = Get-Metric 'insighthub_last_request_timestamp_seconds'
Start-Sleep -Seconds 1
Get-Http "$BaseUrl/api/search-history" $null | Out-Null
Get-Http "$BaseUrl/api/does-not-exist-$PID" $null | Out-Null
$s1 = Get-Metric 'insighthub_http_requests_success_total'; $f1 = Get-Metric 'insighthub_http_requests_failed_total'; $t1 = Get-Metric 'insighthub_last_request_timestamp_seconds'
Write-Host "  success_total $s0 -> $s1 | failed_total $f0 -> $f1 | last_request_ts $t0 -> $t1"
if ($s1 -gt $s0) { Pass 'success counter increased' } else { Bad 'success counter flat' }
if ($f1 -gt $f0) { Pass 'failed counter increased' } else { Bad 'failed counter flat' }
if ($t1 -gt $t0) { Pass 'timestamp advanced' } else { Bad 'timestamp flat' }
$m = (Get-Http "$BaseUrl/metrics" $Token).Body
foreach ($n in 'insighthub_http_requests_total','insighthub_http_request_duration_seconds_bucket','insighthub_last_request_timestamp_seconds','insighthub_storage_up','insighthub_chromadb_up') {
  if ($m -match "(?m)^$n") { Pass "contains $n" } else { Bad "missing $n" }
}
($m -split "`n") | Where-Object { $_ -match 'insighthub_http_requests_total\{.*(unmatched|search-history)' } | ForEach-Object { Write-Host "  $_" }

Write-Host '== 4. storage'
$r = Expect-Code 'storage' 200 "$BaseUrl/api/health/storage" $Token; Write-Host "  $($r.Body)"
if ($StorageFailureTest) {
  $P = 5099; $B = "http://localhost:$P"
  if ((Get-Http "$B/api/health" $null).Code -ne 0) { Bad "port $P already in use; stop it and re-run"; exit 1 }
  $T = Join-Path ([IO.Path]::GetTempPath()) ("insighthub-verify-" + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $T | Out-Null
  $env:PORT = "$P"; $env:DATA_DIR = $T; $env:METRICS_TOKEN = $Token
  $proc = Start-Process node -ArgumentList 'server.js' -WorkingDirectory "$root\backend" -PassThru -WindowStyle Hidden
  Remove-Item Env:PORT, Env:DATA_DIR -ErrorAction SilentlyContinue
  for ($i = 0; $i -lt 30; $i++) { if ((Get-Http "$B/api/health" $null).Code -eq 200) { break }; Start-Sleep -Seconds 1 }
  Expect-Code 'temp instance storage' 200 "$B/api/health/storage" $Token | Out-Null
  Remove-Item -Recurse -Force $T
  $r = Expect-Code 'storage after DATA_DIR removed' 503 "$B/api/health/storage" $Token; Write-Host "  $($r.Body)"
  Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
} else { Write-Host '  (skipped missing-DATA_DIR test; use -StorageFailureTest)' }

Write-Host '== 5. chromadb'
$r = Get-Http "$BaseUrl/api/health/chromadb" $Token; Write-Host "  [HTTP $($r.Code)] $($r.Body)"
if ($ChromaContainer) {
  Expect-Code 'chromadb up' 200 "$BaseUrl/api/health/chromadb" $Token | Out-Null
  docker stop $ChromaContainer | Out-Null
  Expect-Code 'chromadb stopped' 503 "$BaseUrl/api/health/chromadb" $Token | Out-Null
  docker start $ChromaContainer | Out-Null; Start-Sleep -Seconds 5
  Expect-Code 'chromadb restarted' 200 "$BaseUrl/api/health/chromadb" $Token | Out-Null
} else { Write-Host '  (skipped stop/start test; use -ChromaContainer <name>)' }
$r = Get-Http "$BaseUrl/api/health/monitoring" $Token; Write-Host "  combined [HTTP $($r.Code)] $($r.Body)"

Write-Host '== 6. ChromaDB port 8000 not published publicly'
if ($CheckPort8000) {
  docker compose ps
  $c = if ($ChromaContainer) { $ChromaContainer } else { 'chromadb' }
  docker port $c
} else { Write-Host '  (skipped; use -CheckPort8000 with docker running)' }
if ($script:Fail) { Write-Host 'SOME CHECKS FAILED'; exit 1 } else { Write-Host 'ALL CHECKS PASSED' }
