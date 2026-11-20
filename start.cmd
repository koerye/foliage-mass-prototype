@echo off
setlocal EnableExtensions
chcp 65001 >nul
title Vegetation Studio - 程序化植物工作台
pushd "%~dp0" || exit /b 1

if /i "%~1"=="-h" goto usage
if /i "%~1"=="--help" goto usage
if "%~1"=="/?" goto usage

where /q node.exe
if errorlevel 1 goto missing
where /q npm.cmd
if errorlevel 1 goto missing

if not exist "node_modules\.bin\vite.cmd" (
  echo [1/2] 首次运行，正在安装依赖...
  if exist "package-lock.json" (
    call npm ci
  ) else (
    call npm install
  )
  if errorlevel 1 goto fail
)

set "ENTRY=/broadleaf.html"
set "MODE_NAME=经典工作台 · Vegetation Studio v2"
if /i "%~1"=="" goto mode_ok
if /i "%~1"=="broadleaf" goto mode_ok
if /i "%~1"=="ai" set "ENTRY=/ai.html" & set "MODE_NAME=AI 模式 · 空白丢图工程" & goto mode_ok
if /i "%~1"=="sakura" set "ENTRY=/ai.html?showcase=sakura" & set "MODE_NAME=AI 模式 · 三干樱花盆景案例" & goto mode_ok
if /i "%~1"=="legacy" set "ENTRY=/legacy.html" & set "MODE_NAME=旧版工作台 · Legacy" & goto mode_ok
if /i "%~1"=="v1" set "ENTRY=/index.html" & set "MODE_NAME=初代体块原型 · v1" & goto mode_ok
echo 未知模式参数: %~1
goto usage_err

:mode_ok
set "STUDIO_PORT=%~2"
if defined STUDIO_PORT goto port_ok
for /f %%P in ('node -e "const n=require('node:net');const t=p=>new Promise((a,b)=>{const s=n.createServer();s.once('error',b);s.listen(p,'127.0.0.1',()=>{const q=s.address().port;s.close(()=>a(q))})});t(5869).catch(()=>t(0)).then(p=>console.log(p))"') do set "STUDIO_PORT=%%P"

:port_ok
if not defined STUDIO_PORT goto fail

echo.
echo ============================================================
echo   Vegetation Studio 启动中...
echo   当前入口 : %MODE_NAME%
echo ------------------------------------------------------------
echo   经典工作台 : http://127.0.0.1:%STUDIO_PORT%/broadleaf.html
echo   AI 模式    : http://127.0.0.1:%STUDIO_PORT%/ai.html
echo   樱花案例   : http://127.0.0.1:%STUDIO_PORT%/ai.html?showcase=sakura
echo ============================================================
echo   按 Ctrl+C 可停止本地服务。
echo.

if /i "%STUDIO_DRY_RUN%"=="1" (
  echo [DRY_RUN] npm run dev -- --port %STUDIO_PORT% --strictPort --open "%ENTRY%"
  popd
  exit /b 0
)

call npm run dev -- --port %STUDIO_PORT% --strictPort --open "%ENTRY%"
if errorlevel 1 goto fail
popd
exit /b 0

:usage
echo 用法: start.cmd [模式] [端口]
echo.
echo   [双击/无参]  启动经典工作台 /broadleaf.html
echo   broadleaf    启动经典工作台 /broadleaf.html
echo   ai           启动 AI 空白丢图模式 /ai.html
echo   sakura       启动 AI 模式并加载樱花盆景案例
echo   legacy       启动旧版薄片工作台 /legacy.html
echo   v1           启动初代体块原型 /index.html
echo.
echo 示例:
echo   start.cmd
echo   start.cmd ai
echo   start.cmd sakura 5869
popd
exit /b 0

:usage_err
echo.
echo 可选模式: broadleaf ^| ai ^| sakura ^| legacy ^| v1
popd
pause
exit /b 1

:missing
echo 未检测到 Node.js 或 npm，请先安装 Node.js 20/22 LTS。
goto stop

:fail
echo Vegetation Studio 启动失败，请查看上方报错信息。

:stop
popd
pause
exit /b 1