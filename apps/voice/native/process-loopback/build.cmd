@echo off
setlocal enabledelayedexpansion
REM Builds process-loopback.node (x64) with the EWDK's cl — no Visual Studio
REM install. Run inside the mounted EWDK build environment:
REM   cmd /c "call <EWDK>:\BuildEnv\SetupBuildEnv.cmd && build.cmd"
REM SetupBuildEnv only wires the MSVC x86 include path, so this script derives
REM the x64 MSVC + Windows SDK include/lib set itself (auto-detecting the
REM toolset + SDK versions so an EWDK bump doesn't break the build).
REM
REM Node headers + the official win-x64 import lib come from nodejs.org (the
REM same source node-gyp uses), staged under Toolchains — override
REM NODE_HEADERS_DIR to relocate.

if "%NODE_HEADERS_DIR%"=="" set "NODE_HEADERS_DIR=E:\KLONE\Workspace\Toolchains\node-headers\node-v22.22.3"
set "HERE=%~dp0"

if not exist "%NODE_HEADERS_DIR%\include\node\node_api.h" (
  echo error: node headers not found at %NODE_HEADERS_DIR%
  echo   download node-vX-headers.tar.gz + win-x64/node.lib for the runtime node
  echo   version from nodejs.org/dist and point NODE_HEADERS_DIR at the extract.
  exit /b 1
)

REM --- locate the MSVC x64 toolset that SetupBuildEnv put on PATH ---
for %%C in (cl.exe) do set "CL_X86=%%~$PATH:C"
if "%CL_X86%"=="" (
  echo error: cl.exe not on PATH — run inside the EWDK build environment first.
  exit /b 1
)
REM cl sits at <toolset>\bin\Hostx86\x86\cl.exe; walk up to the toolset root.
for %%I in ("%CL_X86%\..\..\..\..") do set "VCTOOLS=%%~fI"
set "CL_X64=%VCTOOLS%\bin\Hostx64\x64\cl.exe"
if not exist "%CL_X64%" (
  echo error: x64 cl not found at %CL_X64%
  exit /b 1
)

REM --- locate the Windows SDK + its newest versioned include/lib set ---
if "%WindowsSdkDir%"=="" (
  echo error: WindowsSdkDir not set — SetupBuildEnv did not run.
  exit /b 1
)
set "SDKVER="
for /f "delims=" %%V in ('dir /b /ad /o-n "%WindowsSdkDir%Include" 2^>nul') do (
  if exist "%WindowsSdkDir%Include\%%V\um\windows.h" if "!SDKVER!"=="" set "SDKVER=%%V"
)
if "%SDKVER%"=="" (
  echo error: no Windows SDK with um\windows.h under %WindowsSdkDir%Include
  exit /b 1
)

set "INCLUDE=%VCTOOLS%\include;%WindowsSdkDir%Include\%SDKVER%\ucrt;%WindowsSdkDir%Include\%SDKVER%\um;%WindowsSdkDir%Include\%SDKVER%\shared;%WindowsSdkDir%Include\%SDKVER%\winrt"
set "LIB=%VCTOOLS%\lib\x64;%WindowsSdkDir%Lib\%SDKVER%\ucrt\x64;%WindowsSdkDir%Lib\%SDKVER%\um\x64"

if not exist "%HERE%build" mkdir "%HERE%build"
echo building with MSVC %VCTOOLS% + SDK %SDKVER%

"%CL_X64%" /nologo /LD /O2 /W4 /EHsc /std:c++20 /DNOMINMAX /DWIN32_LEAN_AND_MEAN ^
  /I"%NODE_HEADERS_DIR%\include\node" ^
  "%HERE%addon.cpp" ^
  /Fo"%HERE%build\\" /Fe"%HERE%build\process-loopback.node" ^
  /link /DLL "%NODE_HEADERS_DIR%\node.lib" ole32.lib mmdevapi.lib uuid.lib
if errorlevel 1 exit /b 1

echo built: %HERE%build\process-loopback.node
