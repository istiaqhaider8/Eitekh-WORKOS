@echo off
title Eitekh WorkOS Server
echo ===================================================
echo           Starting Eitekh WorkOS System            
echo ===================================================
echo.
cd /d "%~dp0"
echo Launching Next.js dev server on http://localhost:3000...
echo.
npm run dev
pause
