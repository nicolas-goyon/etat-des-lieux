# État des lieux – arrêt du serveur (les données sont conservées)
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
Set-Location (Split-Path -Parent $PSScriptRoot)
Write-Host 'Arrêt du serveur État des lieux…' -ForegroundColor Cyan
docker compose down
if ($LASTEXITCODE -eq 0) { Write-Host 'Serveur arrêté. Les données restent dans le dossier data.' -ForegroundColor Green }
