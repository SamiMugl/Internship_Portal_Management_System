# Internship Portal - Start both Backend + Frontend
Write-Host "Starting Internship Portal..." -ForegroundColor Cyan
Write-Host ""
Write-Host "Backend  -> http://localhost:3000" -ForegroundColor Green
Write-Host "Frontend -> http://localhost:5173" -ForegroundColor Green
Write-Host ""
Write-Host "Press Ctrl+C to stop both servers." -ForegroundColor Yellow
Write-Host ""

$backend = Start-Process -FilePath "npm" -ArgumentList "run", "dev" -WorkingDirectory $PSScriptRoot -PassThru -NoNewWindow
$frontend = Start-Process -FilePath "npm" -ArgumentList "run", "dev" -WorkingDirectory (Join-Path $PSScriptRoot "frontend") -PassThru -NoNewWindow

try {
  Wait-Process -Id $backend.Id, $frontend.Id
} finally {
  Stop-Process -Id $backend.Id, $frontend.Id -Force -ErrorAction SilentlyContinue
}
