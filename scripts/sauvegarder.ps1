# État des lieux – sauvegarde du dossier de données dans backups\edl-AAAAMMJJ-HHMM.zip
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
$dataPath = './data'
if (Test-Path '.env') {
  foreach ($line in Get-Content '.env' -Encoding UTF8) { if ($line -match '^\s*DATA_PATH\s*=\s*(.+)$') { $dataPath = $Matches[1].Trim() } }
}
if (-not (Test-Path $dataPath)) { Write-Host "Dossier de données introuvable : $dataPath" -ForegroundColor Red; exit 1 }
New-Item -ItemType Directory -Force -Path 'backups' | Out-Null
$dest = Join-Path 'backups' ("edl-" + (Get-Date -Format 'yyyyMMdd-HHmm') + '.zip')
Write-Host "Sauvegarde de $dataPath vers $dest…" -ForegroundColor Cyan
Compress-Archive -Path (Join-Path $dataPath '*') -DestinationPath $dest -CompressionLevel Optimal -Force
Write-Host "Sauvegarde terminée : $(Resolve-Path $dest)" -ForegroundColor Green
Write-Host "Copiez ce fichier sur une clé USB ou un disque externe." -ForegroundColor Green
