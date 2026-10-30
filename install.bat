@echo off
rem ============================================================
rem  Kestrel CAD - one-time setup for a new computer.
rem  Creates a local Python venv, installs dev dependencies
rem  and (optionally) the GNU LibreDWG DWG codec.
rem  The application itself needs no packages to run; the venv
rem  is for tests and tooling. Run start.bat afterwards.
rem ============================================================
setlocal EnableDelayedExpansion
cd /d "%~dp0"
echo.
echo === Kestrel CAD setup ===

rem --- 1. Locate a Python 3 interpreter (py launcher or python) ---
set "PY="
py -3 -c "import sys;sys.exit(0 if sys.version_info>=(3,9) else 1)" >nul 2>nul
if not errorlevel 1 (
    set "PY=py -3"
) else (
    python -c "import sys;sys.exit(0 if sys.version_info>=(3,9) else 1)" >nul 2>nul
    if not errorlevel 1 (
        set "PY=python"
    )
)
if not defined PY (
    echo [X] Python 3.9+ was not found.
    echo     Install Python from https://www.python.org/downloads/ ^(tick "Add to PATH"^)
    echo     or from the Microsoft Store, then run this script again.
    pause
    exit /b 1
)
echo [1/5] Using Python: %PY%
%PY% -c "import sys;print('       '+sys.executable)"

rem --- 2. Create the local venv ---
if exist ".venv\Scripts\python.exe" (
    echo [2/5] .venv already exists - reusing it.
) else (
    echo [2/5] Creating virtual environment in .venv ...
    %PY% -m venv .venv
    if errorlevel 1 (
        echo [X] Could not create the venv.
        pause
        exit /b 1
    )
)
set "VPY=.venv\Scripts\python.exe"

rem --- 3. Install dev/test dependencies inside the venv ---
echo [3/5] Installing dev dependencies (playwright, ezdxf, fonttools) ...
"%VPY%" -m pip install --upgrade pip -q
"%VPY%" -m pip install -r requirements-dev.txt -q
if errorlevel 1 (
    echo [X] pip install failed. Check your internet connection and rerun.
    pause
    exit /b 1
)
echo       Dev dependencies installed.

rem --- 4. Optional DWG codec: GNU LibreDWG converters ---
set /p INSTALL_DWG="Install the GNU LibreDWG DWG codec (dwg2dxf / dxf2dwg, ~12 MB)? [Y/n] "
if /i "%INSTALL_DWG%"=="n" (
    echo [4/5] Skipped DWG codec. DWG files will open without conversion for now.
    goto :node_check
)
set "DWG_DIR=%LOCALAPPDATA%\Programs\LibreDWG"
if exist "%DWG_DIR%\dwg2dxf.exe" (
    echo [4/5] LibreDWG is already installed at %DWG_DIR%
) else (
    echo [4/5] Downloading LibreDWG Windows build ...
    powershell -NoProfile -Command "$ErrorActionPreference='Stop'; $r=Invoke-RestMethod 'https://api.github.com/repos/LibreDWG/libredwg/releases/latest'; $a=$r.assets | Where-Object { $_.name -like '*win64.zip' } | Select-Object -First 1; New-Item -ItemType Directory -Force -Path \"$env:LOCALAPPDATA\Programs\LibreDWG\" | Out-Null; Invoke-WebRequest $a.browser_download_url -OutFile \"$env:TEMP\libredwg.zip\"; Expand-Archive \"$env:TEMP\libredwg.zip\" -DestinationPath \"$env:LOCALAPPDATA\Programs\LibreDWG\" -Force; Remove-Item \"$env:TEMP\libredwg.zip\"" 
    if errorlevel 1 (
        echo [!] Download failed. DWG conversion stays unavailable;
        echo     install dwg2dxf manually from https://github.com/LibreDWG/libredwg/releases
    ) else (
        echo       Downloaded and extracted to %DWG_DIR%
    )
)
if exist "%DWG_DIR%\dwg2dxf.exe" (
    set "DWG_PATH_ENTRY=%DWG_DIR%"
    call :addpath
    echo       Added to the user PATH. Restart any open terminal windows.
)
:node_check

rem --- 5. Report auxiliary tools ---
echo [5/5] Component check:
where node >nul 2>nul && (echo       node: found ^(needed only for the node test suites^)) || (echo       node: not found ^(optional; needed only to run node test suites^))
where git >nul 2>nul && (echo       git: found) || (echo       git: not found ^(optional^))
if exist ".venv\Scripts\python.exe" (echo       venv: .venv ready)

echo.
echo === Setup finished ===
echo Start the application with:  start.bat  ^(serves http://localhost:8000^)
echo Run the browser test suites: see tools\serve.py + tests\ folder docs.
pause
exit /b 0

rem --- helper: add a directory to the user PATH if missing ---
:addpath
powershell -NoProfile -Command "$p=$env:DWG_PATH_ENTRY; if (-not $p) { exit 1 }; $u=[Environment]::GetEnvironmentVariable('Path','User'); if ($u -notlike ('*'+$p+'*')) { [Environment]::SetEnvironmentVariable('Path', ($u.TrimEnd(';')+';'+$p), 'User'); 'added to user PATH' } else { 'already on PATH' }"
exit /b 0
