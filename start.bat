@echo off
title HTML to Video (MP4) Studio
echo ========================================================
echo   Launching HTML to MP4 Video Studio...
echo ========================================================
echo.
cd /d "%~dp0"
start http://localhost:3000
npm start
pause
