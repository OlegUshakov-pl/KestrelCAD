@echo off
rem Start the Kestrel CAD local server and open it in the default browser.
rem Uses the project venv when present, otherwise the system Python.
cd /d "%~dp0"
set "PY=python"
if exist ".venv\Scripts\python.exe" set "PY=.venv\Scripts\python.exe"
%PY% tools\serve.py --open %*
