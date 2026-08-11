@echo off
echo ========================================================
echo  Starting InsightHub Local Backend API on port 5000
echo ========================================================
cd /d "%~dp0backend"
npm run dev
pause
