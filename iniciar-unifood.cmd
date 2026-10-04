@echo off
setlocal
cd /d "%~dp0"
echo Proyecto: %CD%
echo Entrada: http://localhost:3000
echo En otro dispositivo de la misma red: http://IP-DE-ESTE-PC:3000
echo.
call npm run dev
if errorlevel 1 (
  echo.
  echo No se pudo iniciar UniFood. Revisa el error mostrado arriba.
  pause
)
endlocal
