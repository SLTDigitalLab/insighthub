@echo off
echo ========================================================
echo  InsightHub: Deploying Microsoft SSO Updates to Git
echo ========================================================

echo 1. Staging and committing changes...
if exist .git\index.lock del /f /q .git\index.lock
git add -A
git commit -m "Grant full development admin credentials to 020601@intranet.slt.com.lk"

echo 2. Pushing to GitHub repository...
git push origin InsightHub-check
git push origin InsightHub-check:main

echo ========================================================
echo  Local Git Push Complete!
echo ========================================================
echo.
echo Now deploy to your live server (157.245.159.130):
echo Run this in your server terminal (ssh root@157.245.159.130):
echo.
echo   cd /var/www/insighthub
echo   git pull origin main
echo   cd backend && pm2 restart all
echo   cd ../frontend && npm run build
echo.
pause
