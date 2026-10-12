; Desktop installer: ask before closing topmind, and close only this app.
; Leave Obsidian and agent hosts running. Never close every Electron process.
!macro customCheckAppRunning
  nsExec::Exec `"$SYSDIR\cmd.exe" /C tasklist /FI "IMAGENAME eq ${APP_EXECUTABLE_FILENAME}" /FO CSV /NH | "$SYSDIR\findstr.exe" /B /I /C:"\"${APP_EXECUTABLE_FILENAME}\""`
  Pop $R0
  ${if} $R0 == 0
    MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "topmind is running. Quit topmind and continue the installer? Other apps stay open." /SD IDCANCEL IDCANCEL cancelTopmindOnly
    DetailPrint "Closing ${APP_EXECUTABLE_FILENAME} only"
    nsExec::Exec `taskkill /IM "${APP_EXECUTABLE_FILENAME}"`
    Sleep 400
    nsExec::Exec `"$SYSDIR\cmd.exe" /C tasklist /FI "IMAGENAME eq ${APP_EXECUTABLE_FILENAME}" /FO CSV /NH | "$SYSDIR\findstr.exe" /B /I /C:"\"${APP_EXECUTABLE_FILENAME}\""`
    Pop $R0
    ${if} $R0 == 0
      nsExec::Exec `taskkill /F /IM "${APP_EXECUTABLE_FILENAME}"`
    ${endIf}
    Goto topmindInstallerContinue
    cancelTopmindOnly:
      Quit
  ${endIf}
  topmindInstallerContinue:
!macroend
