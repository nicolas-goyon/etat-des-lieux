# État des lieux – démarrage (Windows / Docker Desktop)
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

function Say($msg, $color = 'Gray') { Write-Host $msg -ForegroundColor $color }
function Read-DotEnv($path) {
  $h = @{}
  if (Test-Path $path) {
    foreach ($line in Get-Content -LiteralPath $path -Encoding UTF8) {
      if ($line -match '^\s*#' -or $line -notmatch '=') { continue }
      $k, $v = $line -split '=', 2
      $h[$k.Trim()] = $v.Trim()
    }
  }
  return $h
}

Say ''
Say '=== État des lieux : démarrage ===' 'Cyan'

# 1. Fichier .env
if (-not (Test-Path '.env')) {
  Copy-Item '.env.example' '.env'
  Say 'Fichier .env créé à partir de .env.example.' 'Yellow'
}
$cfg = Read-DotEnv '.env'
$port = if ($cfg['PORT']) { $cfg['PORT'] } else { '8080' }
$proto = if ($cfg['HTTPS'] -match '^(1|true|yes|oui|on)$') { 'https' } else { 'http' }
if (-not $cfg['ACCESS_CODE'] -or $cfg['ACCESS_CODE'] -eq '1234') {
  Say "ATTENTION : le code d'accès est encore 1234. Modifiez ACCESS_CODE dans le fichier .env (ou dans l'application, Paramètres)." 'Yellow'
}

# 2. Docker Desktop
function Test-Docker { try { docker info --format '{{.ServerVersion}}' 2>$null | Out-Null; return ($LASTEXITCODE -eq 0) } catch { return $false } }
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Say "Docker n'est pas installé. Installez Docker Desktop : https://www.docker.com/products/docker-desktop/" 'Red'
  exit 1
}
if (-not (Test-Docker)) {
  Say 'Lancement de Docker Desktop…'
  $dd = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
  if (Test-Path $dd) { Start-Process $dd | Out-Null }
  $t = 0
  while (-not (Test-Docker) -and $t -lt 180) { Start-Sleep -Seconds 3; $t += 3; Write-Host '.' -NoNewline }
  Write-Host ''
  if (-not (Test-Docker)) { Say "Docker Desktop ne répond pas. Lancez-le à la main puis relancez ce script." 'Red'; exit 1 }
}

# 3. Adresse IP du PC sur le réseau (pour le QR code du téléphone)
$ip = $null
try {
  $ip = Get-NetIPConfiguration |
    Where-Object { $_.IPv4DefaultGateway -ne $null -and $_.NetAdapter.Status -eq 'Up' -and $_.InterfaceAlias -notmatch 'vEthernet|WSL|Docker|VirtualBox|VMware|Hyper-V|Loopback|Bluetooth' } |
    Select-Object -First 1 -ExpandProperty IPv4Address | Select-Object -First 1 -ExpandProperty IPAddress
} catch {}
if (-not $ip) {
  try {
    $ip = Get-NetIPAddress -AddressFamily IPv4 |
      Where-Object { $_.IPAddress -notmatch '^(127\.|169\.254\.)' -and $_.InterfaceAlias -notmatch 'vEthernet|WSL|Docker|VirtualBox|VMware|Loopback' } |
      Select-Object -First 1 -ExpandProperty IPAddress
  } catch {}
}
if ($cfg['PUBLIC_URL']) {
  $publicUrl = $cfg['PUBLIC_URL'].TrimEnd('/')
  Say "Adresse réseau (fixée dans .env) : $publicUrl"
} elseif ($ip) {
  $publicUrl = "${proto}://${ip}:${port}"
  $env:PUBLIC_URL = $publicUrl
  Say "Adresse réseau détectée : $publicUrl"
} else {
  $publicUrl = $null
  Say "Adresse réseau non détectée (pas de Wi-Fi ?). Le téléphone et la tablette ne pourront pas se connecter." 'Yellow'
}

# 4. Construction / démarrage du conteneur
Say 'Démarrage du serveur (la première fois, la construction prend 1 à 2 minutes)…'
docker compose up -d --build
if ($LASTEXITCODE -ne 0) { Say 'Échec du démarrage. Voir les messages ci-dessus.' 'Red'; exit 1 }

# 5. Attente que le serveur réponde
$local = "${proto}://localhost:${port}"
$ok = $false
for ($i = 0; $i -lt 40; $i++) {
  try {
    if ($proto -eq 'https') { [System.Net.ServicePointManager]::ServerCertificateValidationCallback = { $true } }
    $r = Invoke-WebRequest -Uri "$local/api/health" -UseBasicParsing -TimeoutSec 3
    if ($r.StatusCode -eq 200) { $ok = $true; break }
  } catch {}
  Start-Sleep -Seconds 1
}
if (-not $ok) { Say "Le serveur ne répond pas encore. Consultez les journaux : docker compose logs" 'Yellow' }

Say ''
Say '=================================================================' 'Green'
Say "  Sur ce PC          : $local" 'Green'
if ($publicUrl) { Say "  Tablette / tél.    : $publicUrl   (même Wi-Fi)" 'Green' }
Say "  Données            : $(Resolve-Path -LiteralPath $(if ($cfg['DATA_PATH']) { $cfg['DATA_PATH'] } else { './data' }) -ErrorAction SilentlyContinue)" 'Green'
Say '=================================================================' 'Green'
Say ''
Say "Si la tablette ou le téléphone n'arrive pas à se connecter : autorisez Docker Desktop"
Say "dans le pare-feu Windows pour les réseaux privés, et vérifiez que le Wi-Fi du PC est"
Say "en profil « Réseau privé » (Paramètres > Réseau et Internet > Wi-Fi > propriétés)."
Say ''
Start-Process $local
