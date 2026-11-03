@echo off
setlocal
chcp 65001 >nul
set "PYTHONUTF8=1"
pushd "%~dp0"
if errorlevel 1 exit /b 1

py -3 -c "import sys; sys.exit(sys.version_info.major != 3)" >nul 2>&1
if not errorlevel 1 (
    set "PYTHON=py -3"
    goto start
)
python -c "import sys; sys.exit(sys.version_info.major != 3)" >nul 2>&1
if not errorlevel 1 (
    set "PYTHON=python"
    goto start
)
python3 -c "import sys; sys.exit(sys.version_info.major != 3)" >nul 2>&1
if not errorlevel 1 (
    set "PYTHON=python3"
    goto start
)
echo Python 3 was not found. Install Python 3 and enable "Add Python to PATH".
popd
pause
exit /b 1

:start
echo Recipe Studio: http://127.0.0.1:8766/
echo Keep this window open while using the editor. Press Ctrl+C to stop.
%PYTHON% server.py --open %*
set "RESULT=%ERRORLEVEL%"
popd
if not "%RESULT%"=="0" (
    echo Startup failed. See the error above.
    pause
)
exit /b %RESULT%
