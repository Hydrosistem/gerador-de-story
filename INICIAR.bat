@echo off
chcp 65001 >nul
title Lar de Achadinhos - Gerador de Ofertas
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  O Node.js nao esta instalado. Baixe em https://nodejs.org ^(versao LTS^) e rode este arquivo de novo.
  echo.
  pause
  exit /b
)
node server.js
pause
