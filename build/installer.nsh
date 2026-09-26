; Kval StateScope desktop installer: additions to electron-builder's NSIS installer (package.json build.nsis.include)
;  - "Open in Kval StateScope" in Windows Explorer's context menu of .TcPOU files
;  - optional components: the TwinCAT XAE extension for Visual Studio 2022 / 2026 and for TcXaeShell, and the web
;    edition's live view helpers Kval StateScope Link and the gateway
; The components' files are staged in release\installer-extras by scripts\prepare-installer.cjs (npm run build:exe).

!include nsDialogs.nsh
!include LogicLib.nsh

!define KSS_EXTRAS "${PROJECT_DIR}\release\installer-extras"
!define KSS_REG "Software\Kval\StateScope"
; A verb of all files (*), shown only for .TcPOU (AppliesTo): Explorer skips SystemFileAssociations\.TcPOU when the
; extension itself is not registered (TwinCAT does not register it), whatever program opens it
!define KSS_MENU_KEY "Software\Classes\*\shell\KvalStateScope"
; Where earlier versions put it (removed on install and uninstall)
!define KSS_MENU_KEY_OLD "Software\Classes\SystemFileAssociations\.TcPOU\shell\KvalStateScope.Open"
!define KSS_PS 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File'

!macro kssRefreshShell
  ; SHCNE_ASSOCCHANGED: Explorer re-reads the context menu registrations
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!ifndef BUILD_UNINSTALLER
  Var kssMenu
  Var kssVs
  Var kssXae
  Var kssLink
  Var kssGateway
  Var kssVsNames
  Var kssXaeFound
  Var kssDetected
  Var kssMenuBox
  Var kssVsBox
  Var kssXaeBox
  Var kssLinkBox
  Var kssGatewayBox
  Var kssGatewayDir

  ; The previous installation's choices (the context menu is on by default)
  !macro kssReadChoice name var default
    StrCpy ${var} ${default}
    ClearErrors
    ReadRegDWORD $0 HKCU "${KSS_REG}" "${name}"
    ${IfNot} ${Errors}
      StrCpy ${var} $0
    ${Else}
      ClearErrors
      ReadRegDWORD $0 HKLM "${KSS_REG}" "${name}"
      ${IfNot} ${Errors}
        StrCpy ${var} $0
      ${EndIf}
    ${EndIf}
  !macroend

  !macro customInit
    !insertmacro kssReadChoice "ContextMenu" $kssMenu 1
    !insertmacro kssReadChoice "VisualStudio" $kssVs 0
    !insertmacro kssReadChoice "TcXaeShell" $kssXae 0
    !insertmacro kssReadChoice "Link" $kssLink 0
    !insertmacro kssReadChoice "Gateway" $kssGateway 0
    StrCpy $kssDetected 0
  !macroend

  ; The page and its functions: inserted where the pages are declared, after the Modern UI is loaded
  !macro customPageAfterChangeDir
    Page custom kssPageCreate kssPageLeave

    ; What is on this computer: Visual Studio 2022 / 2026 (vswhere), TcXaeShell 64-bit
    Function kssDetect
      ${If} $kssDetected == 1
        Return
      ${EndIf}
      StrCpy $kssDetected 1
      InitPluginsDir
      SetOutPath "$PLUGINSDIR"
      File "${KSS_EXTRAS}\vs-extension.ps1"
      nsExec::ExecToStack '${KSS_PS} "$PLUGINSDIR\vs-extension.ps1" -Action Detect'
      Pop $0
      Pop $1
      ${If} $0 == 0
        ; One line: trim the line break
        ${Do}
          StrCpy $2 $1 1 -1
          ${If} $2 == "$\n"
          ${OrIf} $2 == "$\r"
            StrCpy $1 $1 -1
          ${Else}
            ${ExitDo}
          ${EndIf}
        ${Loop}
        StrCpy $kssVsNames $1
      ${Else}
        StrCpy $kssVsNames ""
      ${EndIf}
      StrCpy $kssXaeFound 0
      ${If} ${FileExists} "$PROGRAMFILES64\Beckhoff\TcXaeShell\Common7\IDE\TcXaeShell.exe"
        StrCpy $kssXaeFound 1
      ${EndIf}
    FunctionEnd

    Function kssPageCreate
      Call kssDetect
      !insertmacro MUI_HEADER_TEXT "Additional components" "Choose what to install with Kval StateScope."
      nsDialogs::Create 1018
      Pop $0
      ${If} $0 == error
        Abort
      ${EndIf}

      ${NSD_CreateLabel} 0 0 100% 10u "Windows Explorer"
      Pop $0
      ${NSD_CreateCheckbox} 8u 11u -8u 10u "&Open in Kval StateScope, in the right-click menu of .TcPOU files"
      Pop $kssMenuBox
      ${NSD_SetState} $kssMenuBox $kssMenu

      ${NSD_CreateLabel} 0 28u 100% 10u "TwinCAT XAE extension: open a POU in a document tab, Save to project, Live view"
      Pop $0
      ${If} $kssVsNames != ""
        ${NSD_CreateCheckbox} 8u 39u -8u 10u "&Visual Studio ($kssVsNames)"
        Pop $kssVsBox
        ${NSD_SetState} $kssVsBox $kssVs
      ${Else}
        ${NSD_CreateCheckbox} 8u 39u -8u 10u "&Visual Studio 2022 / 2026 (not found on this computer)"
        Pop $kssVsBox
        EnableWindow $kssVsBox 0
      ${EndIf}
      ${If} $kssXaeFound == 1
        ${NSD_CreateCheckbox} 8u 51u -8u 10u "&TcXaeShell 64-bit (asks for administrator rights)"
        Pop $kssXaeBox
        ${NSD_SetState} $kssXaeBox $kssXae
      ${Else}
        ${NSD_CreateCheckbox} 8u 51u -8u 10u "&TcXaeShell 64-bit (not found on this computer)"
        Pop $kssXaeBox
        EnableWindow $kssXaeBox 0
      ${EndIf}

      ${NSD_CreateLabel} 0 68u 100% 10u "Web edition: live view from a browser"
      Pop $0
      ${NSD_CreateCheckbox} 8u 79u -8u 10u "Kval StateScope &Link: the helper for a browser on this computer"
      Pop $kssLinkBox
      ${NSD_SetState} $kssLinkBox $kssLink
      ${NSD_CreateCheckbox} 8u 91u -8u 10u "Kval StateScope &gateway: a shared server for a team (needs Node.js 20 or later)"
      Pop $kssGatewayBox
      ${NSD_SetState} $kssGatewayBox $kssGateway

      ${NSD_CreateLabel} 8u 108u -8u 30u "Close Visual Studio and TcXaeShell before installing their extension. The gateway is set up after installing: see README.md in its folder (Start menu: Kval StateScope Gateway)."
      Pop $0
      nsDialogs::Show
    FunctionEnd

    Function kssPageLeave
      ${NSD_GetState} $kssMenuBox $kssMenu
      ${NSD_GetState} $kssLinkBox $kssLink
      ${NSD_GetState} $kssGatewayBox $kssGateway
      ${If} $kssVsNames != ""
        ${NSD_GetState} $kssVsBox $kssVs
      ${Else}
        StrCpy $kssVs 0
      ${EndIf}
      ${If} $kssXaeFound == 1
        ${NSD_GetState} $kssXaeBox $kssXae
      ${Else}
        StrCpy $kssXae 0
      ${EndIf}
    FunctionEnd

  !macroend

  ; Runs a helper; exit code 2 (the IDE is running) asks to close it and retry
  !macro kssRunHelper command what ide
    ${Do}
      DetailPrint "Installing the ${what}..."
      nsExec::ExecToLog '${command}'
      Pop $0
      ${If} $0 == 2
        ${IfNot} ${Cmd} `MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "Close ${ide}, then click Retry to install the ${what}.$\n$\nCancel skips it: run this setup again later to install it." /SD IDCANCEL IDRETRY`
          ${Break}
        ${EndIf}
      ${Else}
        ${If} $0 != 0
          MessageBox MB_OK|MB_ICONEXCLAMATION "The ${what} could not be installed (code $0). Kval StateScope itself is installed; run this setup again to retry." /SD IDOK
        ${EndIf}
        ${Break}
      ${EndIf}
    ${Loop}
  !macroend

  !macro customInstall
    ; Silent installs and updates: the previous choices (read in customInit)
    ${If} ${Silent}
      Call kssDetect
      ${If} $kssVsNames == ""
        StrCpy $kssVs 0
      ${EndIf}
      ${If} $kssXaeFound != 1
        StrCpy $kssXae 0
      ${EndIf}
    ${EndIf}

    ; Explorer's context menu of .TcPOU files (HKCU for this user, HKLM for all users)
    DeleteRegKey SHCTX "${KSS_MENU_KEY_OLD}"
    ${If} $kssMenu == 1
      WriteRegStr SHCTX "${KSS_MENU_KEY}" "" "Open in Kval StateScope"
      WriteRegStr SHCTX "${KSS_MENU_KEY}" "Icon" '"$appExe",0'
      WriteRegStr SHCTX "${KSS_MENU_KEY}" "AppliesTo" 'System.FileName:"*.TcPOU"'
      WriteRegStr SHCTX "${KSS_MENU_KEY}\command" "" '"$appExe" "%1"'
    ${Else}
      DeleteRegKey SHCTX "${KSS_MENU_KEY}"
    ${EndIf}
    !insertmacro kssRefreshShell

    ; Helpers kept for the uninstaller
    SetOutPath "$INSTDIR\installer"
    File "${KSS_EXTRAS}\vs-extension.ps1"
    File "${KSS_EXTRAS}\install-tcxaeshell.ps1"

    ${If} $kssVs == 1
    ${OrIf} $kssXae == 1
      File "${KSS_EXTRAS}\KvalStateScope.Xae.vsix"
    ${EndIf}
    ${If} $kssVs == 1
      !insertmacro kssRunHelper '${KSS_PS} "$INSTDIR\installer\vs-extension.ps1" -Action Install -Vsix "$INSTDIR\installer\KvalStateScope.Xae.vsix"' "Visual Studio extension" "Visual Studio"
    ${EndIf}
    ${If} $kssXae == 1
      !insertmacro kssRunHelper '${KSS_PS} "$INSTDIR\installer\install-tcxaeshell.ps1" -Quiet -Vsix "$INSTDIR\installer\KvalStateScope.Xae.vsix"' "TcXaeShell extension" "TcXaeShell"
    ${EndIf}

    ; Kval StateScope Link: the exe and a Start menu shortcut
    ${If} $kssLink == 1
      SetOutPath "$INSTDIR\Link"
      File "${KSS_EXTRAS}\link\Kval StateScope Link.exe"
      CreateShortCut "$SMPROGRAMS\Kval StateScope Link.lnk" "$INSTDIR\Link\Kval StateScope Link.exe"
    ${Else}
      Delete "$SMPROGRAMS\Kval StateScope Link.lnk"
    ${EndIf}

    ; The gateway: outside the program folder, so its config.json, certificate and tokens survive updates
    ${If} $kssGateway == 1
      ${If} $installMode == "all"
        ; The shell context is "all" here: $APPDATA is C:\ProgramData
        StrCpy $kssGatewayDir "$APPDATA\KvalStateScope\Gateway"
      ${Else}
        StrCpy $kssGatewayDir "$LOCALAPPDATA\KvalStateScope\Gateway"
      ${EndIf}
      SetOutPath "$kssGatewayDir"
      File /r "${KSS_EXTRAS}\gateway\*.*"
      CreateShortCut "$SMPROGRAMS\Kval StateScope Gateway.lnk" "$kssGatewayDir"
      WriteRegStr SHCTX "${KSS_REG}" "GatewayDir" "$kssGatewayDir"
      nsExec::ExecToStack 'cmd.exe /c node --version'
      Pop $0
      Pop $1
      ${If} $0 != 0
        MessageBox MB_OK|MB_ICONINFORMATION "The gateway is in $kssGatewayDir.$\n$\nIt runs on Node.js 20 or later, which was not found: install it from nodejs.org, then follow README.md in that folder." /SD IDOK
      ${EndIf}
    ${EndIf}

    WriteRegDWORD SHCTX "${KSS_REG}" "ContextMenu" $kssMenu
    WriteRegDWORD SHCTX "${KSS_REG}" "VisualStudio" $kssVs
    WriteRegDWORD SHCTX "${KSS_REG}" "TcXaeShell" $kssXae
    WriteRegDWORD SHCTX "${KSS_REG}" "Link" $kssLink
    WriteRegDWORD SHCTX "${KSS_REG}" "Gateway" $kssGateway
    SetOutPath "$INSTDIR"
  !macroend
!endif

!macro customUnInstall
  DeleteRegKey SHCTX "${KSS_MENU_KEY}"
  DeleteRegKey SHCTX "${KSS_MENU_KEY_OLD}"
  !insertmacro kssRefreshShell
  Delete "$SMPROGRAMS\Kval StateScope Link.lnk"
  ; An update runs the old version's uninstaller first: the extensions and the gateway stay
  ${IfNot} ${isUpdated}
    ReadRegDWORD $0 SHCTX "${KSS_REG}" "VisualStudio"
    ${If} $0 == 1
      DetailPrint "Removing the Visual Studio extension..."
      nsExec::ExecToLog '${KSS_PS} "$INSTDIR\installer\vs-extension.ps1" -Action Uninstall'
      Pop $0
    ${EndIf}
    ReadRegDWORD $0 SHCTX "${KSS_REG}" "TcXaeShell"
    ${If} $0 == 1
      DetailPrint "Removing the TcXaeShell extension..."
      nsExec::ExecToLog '${KSS_PS} "$INSTDIR\installer\install-tcxaeshell.ps1" -Quiet -Uninstall'
      Pop $0
    ${EndIf}
    ; The gateway's program files; its config.json, certificate and key stay
    ClearErrors
    ReadRegStr $1 SHCTX "${KSS_REG}" "GatewayDir"
    ${IfNot} ${Errors}
    ${AndIf} $1 != ""
      RMDir /r "$1\public"
      RMDir /r "$1\shared"
      RMDir /r "$1\node_modules"
      Delete "$1\gateway.cjs"
      Delete "$1\package.json"
      Delete "$1\package-lock.json"
      Delete "$1\README.md"
      RMDir "$1"
      Delete "$SMPROGRAMS\Kval StateScope Gateway.lnk"
    ${EndIf}
    DeleteRegKey SHCTX "${KSS_REG}"
  ${EndIf}
!macroend
