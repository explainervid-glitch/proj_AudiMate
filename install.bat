@echo off
:: ============================================================
:: AudiMate v0.5.0 - Installer Launcher
:: ============================================================

:: Jalankan PowerShell dan tunggu sampai selesai (-Wait)
:: -NoExit memastikan window tidak tutup jika ada error awal
powershell.exe -NoProfile -ExecutionPolicy Bypass -NoExit -Command ^
    "try { & '%~dp0operator.ps1' } catch { Write-Host $_.Exception.Message -ForegroundColor Red; Read-Host 'Press Enter to exit' }"

:: Fallback pause — jaga-jaga jika PowerShell keluar tanpa Read-Host
pause