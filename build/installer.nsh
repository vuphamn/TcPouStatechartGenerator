; Kval MachineScope desktop installer: additions to electron-builder's NSIS installer (package.json build.nsis.include)
;  - "Open in Kval MachineScope" in Windows Explorer's context menu of .TcPOU files
;  - optional components on two pages: the TwinCAT XAE extension for Visual Studio 2022 / 2026 and for TcXaeShell, 4026's
;    and 4024's (on by default when found), and the web edition's live view helpers Kval MachineScope Link and the gateway (off)
; The components' files are staged in release\installer-extras by scripts\prepare-installer.cjs (npm run build:exe).

!include nsDialogs.nsh
!include LogicLib.nsh

!define KSS_EXTRAS "${PROJECT_DIR}\release\installer-extras"
!define KSS_REG "Software\Kval\MachineScope"
; A verb of all files (*), shown only for .TcPOU (AppliesTo): Explorer skips SystemFileAssociations\.TcPOU when the
; extension itself is not registered (TwinCAT does not register it), whatever program opens it
!define KSS_MENU_KEY "Software\Classes\*\shell\KvalMachineScope"
!define KSS_PS 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File'
; TcXaeShell: TwinCAT 4026's (64-bit), TwinCAT 4024's (32-bit, the Visual Studio 2017 shell)
!define KSS_XAE64 "$PROGRAMFILES64\Beckhoff\TcXaeShell"
!define KSS_XAE32 "$PROGRAMFILES32\Beckhoff\TcXaeShell"

!macro kssRefreshShell
  ; SHCNE_ASSOCCHANGED: Explorer re-reads the context menu registrations
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!ifndef BUILD_UNINSTALLER
  Var kssMenu
  Var kssVs
  Var kssXae
  Var kssXae24
  Var kssLink
  Var kssLinkStartup
  Var kssGateway
  Var kssVsNames
  Var kssXaeFound
  Var kssXaeTc
  Var kssXae24Found
  Var kssDetected
  Var kssMenuBox
  Var kssVsBox
  Var kssXaeBox
  Var kssXae24Box
  Var kssLinkBox
  Var kssLinkStartupBox
  Var kssGatewayBox
  Var kssGatewayDir

  ; The previous installation's choices (by default: the context menu and the XAE extension on, Link and the gateway off;
  ; Link always unchecked on the page, see customInit)
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
    ; (the TwinCAT XAE extension: on by default, when its IDE is found; a silent first install leaves it out: TcXaeShell's
    ; asks for administrator rights)
    ${If} ${Silent}
      !insertmacro kssReadChoice "VisualStudio" $kssVs 0
      !insertmacro kssReadChoice "TcXaeShell" $kssXae 0
      !insertmacro kssReadChoice "TcXaeShell4024" $kssXae24 0
    ${Else}
      !insertmacro kssReadChoice "VisualStudio" $kssVs 1
      !insertmacro kssReadChoice "TcXaeShell" $kssXae 1
      !insertmacro kssReadChoice "TcXaeShell4024" $kssXae24 1
    ${EndIf}
    ; (Link and its start at sign-in: unchecked on the page, whatever was chosen before; an update, silent (Update now),
    ; keeps what was installed)
    ${If} ${Silent}
      !insertmacro kssReadChoice "Link" $kssLink 0
      !insertmacro kssReadChoice "LinkStartup" $kssLinkStartup 0
    ${Else}
      StrCpy $kssLink 0
      StrCpy $kssLinkStartup 0
    ${EndIf}
    !insertmacro kssReadChoice "Gateway" $kssGateway 0
    StrCpy $kssDetected 0
  !macroend

  ; A heading, and the text under an option (grey)
  !macro kssHeading y text
    ${NSD_CreateLabel} 0 ${y} 100% 10u "${text}"
    Pop $0
    CreateFont $1 "$(^Font)" "$(^FontSize)" 700
    SendMessage $0 ${WM_SETFONT} $1 0
  !macroend
  !macro kssNote x y h text
    ${NSD_CreateLabel} ${x} ${y} -${x} ${h} "${text}"
    Pop $0
    SetCtlColors $0 0x5A5A5A transparent
  !macroend

  ; The pages and their functions: inserted where the pages are declared, after the Modern UI is loaded. Two pages:
  ; the desktop app and the TwinCAT XAE edition (what an engineer with a laptop at the PLC uses: on by default), then
  ; the web edition's helpers (off by default). Each option with what it is for.
  !macro customPageAfterChangeDir
    Page custom kssPageCreate kssPageLeave
    Page custom kssPage2Create kssPage2Leave

    ; What is on this computer: Visual Studio 2022 / 2026 (vswhere), TcXaeShell 64-bit (TwinCAT 4024 or 4026: both Visual
    ; Studio 2022 shells, in the same folder) and 32-bit (4024's Visual Studio 2017 shell); TwinCAT's build here
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
      ${If} ${FileExists} "${KSS_XAE64}\Common7\IDE\TcXaeShell.exe"
        StrCpy $kssXaeFound 1
      ${EndIf}
      ; (TwinCAT's build: the 64-bit shell is 4024's or 4026's; "" when not known)
      StrCpy $kssXaeTc ""
      SetRegView 32
      ClearErrors
      ReadRegDWORD $0 HKLM "SOFTWARE\Beckhoff\TwinCAT3\System" "Build"
      ${IfNot} ${Errors}
        ${If} $0 >= 4026
          StrCpy $kssXaeTc "4026"
        ${ElseIf} $0 >= 4024
          StrCpy $kssXaeTc "4024"
        ${EndIf}
      ${EndIf}
      SetRegView lastused
      StrCpy $kssXae24Found 0
      ${If} ${FileExists} "${KSS_XAE32}\Common7\IDE\TcXaeShell.exe"
        StrCpy $kssXae24Found 1
      ${EndIf}
    FunctionEnd

    ; Page 1: the desktop app, the TwinCAT XAE edition
    Function kssPageCreate
      Call kssDetect
      !insertmacro MUI_HEADER_TEXT "Desktop and TwinCAT XAE editions" "For the engineer at the PLC: the app on this computer, and inside TwinCAT XAE."
      nsDialogs::Create 1018
      Pop $0
      ${If} $0 == error
        Abort
      ${EndIf}

      !insertmacro kssHeading 0 "Desktop app (always installed)"
      !insertmacro kssNote 8u 10u 18u "Opens a TwinCAT project's POUs (.TcPOU): the statechart, editors, simulation, and Live view of a PLC through this PC's ADS router."
      ${NSD_CreateCheckbox} 8u 30u -8u 10u "&Explorer: Open in Kval MachineScope (right-click a .TcPOU file)"
      Pop $kssMenuBox
      ${NSD_SetState} $kssMenuBox $kssMenu

      !insertmacro kssHeading 44u "TwinCAT XAE edition (the extension; close the IDE before installing)"
      !insertmacro kssNote 8u 54u 18u "The app inside XAE: a POU opens in a document tab, Save writes to the project, Build shows XAE's errors, Live uses XAE's PLC."
      ${If} $kssVsNames != ""
        ${NSD_CreateCheckbox} 8u 73u -8u 10u "&Visual Studio ($kssVsNames)"
        Pop $kssVsBox
        ${NSD_SetState} $kssVsBox $kssVs
      ${Else}
        ${NSD_CreateCheckbox} 8u 73u -8u 10u "&Visual Studio 2022 / 2026 (not found on this computer)"
        Pop $kssVsBox
        EnableWindow $kssVsBox 0
      ${EndIf}
      !insertmacro kssNote 20u 83u 10u "TwinCAT 3.1 build 4026 and later, integrated in Visual Studio."
      ${If} $kssXaeFound == 1
        ${If} $kssXaeTc != ""
          ${NSD_CreateCheckbox} 8u 95u -8u 10u "&TcXaeShell 64-bit, TwinCAT $kssXaeTc (asks for administrator rights)"
        ${Else}
          ${NSD_CreateCheckbox} 8u 95u -8u 10u "&TcXaeShell 64-bit, TwinCAT 4024 / 4026 (asks for administrator rights)"
        ${EndIf}
        Pop $kssXaeBox
        ${NSD_SetState} $kssXaeBox $kssXae
      ${Else}
        ${NSD_CreateCheckbox} 8u 95u -8u 10u "&TcXaeShell 64-bit, TwinCAT 4024 / 4026 (not found on this computer)"
        Pop $kssXaeBox
        EnableWindow $kssXaeBox 0
      ${EndIf}
      !insertmacro kssNote 20u 105u 10u "The 64-bit TcXaeShell of TwinCAT 3.1 build 4024 or 4026, in Program Files."
      ${If} $kssXae24Found == 1
        ${NSD_CreateCheckbox} 8u 117u -8u 10u "TcXaeShell &32-bit, TwinCAT 4024 (asks for administrator rights)"
        Pop $kssXae24Box
        ${NSD_SetState} $kssXae24Box $kssXae24
      ${Else}
        ${NSD_CreateCheckbox} 8u 117u -8u 10u "TcXaeShell &32-bit, TwinCAT 4024 (not found on this computer)"
        Pop $kssXae24Box
        EnableWindow $kssXae24Box 0
      ${EndIf}
      !insertmacro kssNote 20u 127u 10u "TwinCAT 3.1 build 4024's TcXaeShell (a Visual Studio 2017 shell), in Program Files (x86)."
      nsDialogs::Show
    FunctionEnd

    Function kssPageLeave
      ${NSD_GetState} $kssMenuBox $kssMenu
      ${If} $kssVsNames != ""
        ${NSD_GetState} $kssVsBox $kssVs
      ${Else}
        StrCpy $kssVs 0
      ${EndIf}
      ${If} $kssXae24Found == 1
        ${NSD_GetState} $kssXae24Box $kssXae24
      ${Else}
        StrCpy $kssXae24 0
      ${EndIf}
      ${If} $kssXaeFound == 1
        ${NSD_GetState} $kssXaeBox $kssXae
      ${Else}
        StrCpy $kssXae 0
      ${EndIf}
    FunctionEnd

    ; Page 2: the web edition's helpers (off by default)
    Function kssPage2Create
      !insertmacro MUI_HEADER_TEXT "Web edition helpers (optional)" "Only for using Kval MachineScope in a browser; not needed with the desktop app or XAE."
      nsDialogs::Create 1018
      Pop $0
      ${If} $0 == error
        Abort
      ${EndIf}

      !insertmacro kssHeading 0 "Web edition (nothing to install)"
      !insertmacro kssNote 8u 10u 18u "The app in a browser (its web page, or a gateway's). A browser cannot reach a PLC by itself: Live view needs a helper below."
      ${NSD_CreateCheckbox} 8u 31u -8u 10u "Kval MachineScope &Link: live view for a browser on this computer"
      Pop $kssLinkBox
      ${NSD_SetState} $kssLinkBox $kssLink
      !insertmacro kssNote 20u 42u 26u "A program in the notification area: lets the web edition in this PC's browser reach PLCs through this PC's TwinCAT router, and open and save the project's files."
      ${NSD_CreateCheckbox} 20u 69u -20u 10u "&Start Link when I sign in (minimized)"
      Pop $kssLinkStartupBox
      ${NSD_SetState} $kssLinkStartupBox $kssLinkStartup
      ${NSD_CreateCheckbox} 8u 84u -8u 10u "Kval MachineScope &gateway: the web edition and live view for a team"
      Pop $kssGatewayBox
      ${NSD_SetState} $kssGatewayBox $kssGateway
      !insertmacro kssNote 20u 95u 35u "A server (on a machine's or the office's PC) that serves the web edition, with Live view of its PLCs, to browsers on other computers (HTTPS, access tokens). Needs Node.js 20+; set up after installing: README.md in its folder (Start menu)."
      nsDialogs::Show
    FunctionEnd

    Function kssPage2Leave
      ${NSD_GetState} $kssLinkBox $kssLink
      ${NSD_GetState} $kssLinkStartupBox $kssLinkStartup
      ${If} $kssLink != 1
        StrCpy $kssLinkStartup 0
      ${EndIf}
      ${NSD_GetState} $kssGatewayBox $kssGateway
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
          MessageBox MB_OK|MB_ICONEXCLAMATION "The ${what} could not be installed (code $0). Kval MachineScope itself is installed; run this setup again to retry." /SD IDOK
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
      ${If} $kssXae24Found != 1
        StrCpy $kssXae24 0
      ${EndIf}
    ${EndIf}

    ; Explorer's context menu of .TcPOU files (HKCU for this user, HKLM for all users)
    ${If} $kssMenu == 1
      WriteRegStr SHCTX "${KSS_MENU_KEY}" "" "Open in Kval MachineScope"
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
    ; What the installer set up, checked (read-only): its Start menu shortcut
    File "${KSS_EXTRAS}\check-install.ps1"
    CreateShortCut "$SMPROGRAMS\Kval MachineScope - check installation.lnk" "powershell.exe" '-NoProfile -ExecutionPolicy Bypass -NoExit -File "$INSTDIR\installer\check-install.ps1"' "$appExe" 0

    ${If} $kssVs == 1
    ${OrIf} $kssXae == 1
      File "${KSS_EXTRAS}\KvalMachineScope.Xae.vsix"
    ${EndIf}
    ${If} $kssVs == 1
      !insertmacro kssRunHelper '${KSS_PS} "$INSTDIR\installer\vs-extension.ps1" -Action Install -Vsix "$INSTDIR\installer\KvalMachineScope.Xae.vsix"' "Visual Studio extension" "Visual Studio"
    ${EndIf}
    ${If} $kssXae == 1
      !insertmacro kssRunHelper '${KSS_PS} "$INSTDIR\installer\install-tcxaeshell.ps1" -Quiet -ShellRoot "${KSS_XAE64}" -Vsix "$INSTDIR\installer\KvalMachineScope.Xae.vsix"' "TcXaeShell extension" "TcXaeShell"
    ${EndIf}
    ${If} $kssXae24 == 1
      File "${KSS_EXTRAS}\KvalMachineScope.Xae.Vs2017.vsix"
      !insertmacro kssRunHelper '${KSS_PS} "$INSTDIR\installer\install-tcxaeshell.ps1" -Quiet -ShellRoot "${KSS_XAE32}" -Vsix "$INSTDIR\installer\KvalMachineScope.Xae.Vs2017.vsix"' "TcXaeShell (TwinCAT 4024) extension" "TcXaeShell"
    ${EndIf}

    ; Kval MachineScope Link: the exe and a Start menu shortcut
    ${If} $kssLink == 1
      SetOutPath "$INSTDIR\Link"
      File "${KSS_EXTRAS}\link\Kval MachineScope Link.exe"
      CreateShortCut "$SMPROGRAMS\Kval MachineScope Link.lnk" "$INSTDIR\Link\Kval MachineScope Link.exe"
    ${Else}
      Delete "$SMPROGRAMS\Kval MachineScope Link.lnk"
    ${EndIf}
    ; Start Link when this user signs in: the same shortcut as Link's page makes (this user's Startup folder, even when
    ; installed for all users: minimized, without opening its page)
    SetShellVarContext current
    ${If} $kssLinkStartup == 1
      CreateShortCut "$SMSTARTUP\Kval MachineScope Link.lnk" "$INSTDIR\Link\Kval MachineScope Link.exe" "--no-open" "" "" SW_SHOWMINIMIZED "" "Kval MachineScope Link (started when you sign in: set on its page)"
    ${ElseIf} $kssLink != 1
      Delete "$SMSTARTUP\Kval MachineScope Link.lnk"
    ${EndIf}
    ${If} $installMode == "all"
      SetShellVarContext all
    ${EndIf}

    ; The gateway: outside the program folder, so its config.json, certificate and tokens survive updates
    ${If} $kssGateway == 1
      ${If} $installMode == "all"
        ; The shell context is "all" here: $APPDATA is C:\ProgramData
        StrCpy $kssGatewayDir "$APPDATA\KvalMachineScope\Gateway"
      ${Else}
        StrCpy $kssGatewayDir "$LOCALAPPDATA\KvalMachineScope\Gateway"
      ${EndIf}
      SetOutPath "$kssGatewayDir"
      File /r "${KSS_EXTRAS}\gateway\*.*"
      CreateShortCut "$SMPROGRAMS\Kval MachineScope Gateway.lnk" "$kssGatewayDir"
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
    WriteRegDWORD SHCTX "${KSS_REG}" "TcXaeShell4024" $kssXae24
    WriteRegDWORD SHCTX "${KSS_REG}" "Link" $kssLink
    WriteRegDWORD SHCTX "${KSS_REG}" "LinkStartup" $kssLinkStartup
    WriteRegDWORD SHCTX "${KSS_REG}" "Gateway" $kssGateway
    SetOutPath "$INSTDIR"
  !macroend
!endif

!macro customUnInstall
  DeleteRegKey SHCTX "${KSS_MENU_KEY}"
  !insertmacro kssRefreshShell
  Delete "$SMPROGRAMS\Kval MachineScope Link.lnk"
  Delete "$SMPROGRAMS\Kval MachineScope - check installation.lnk"
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
      nsExec::ExecToLog '${KSS_PS} "$INSTDIR\installer\install-tcxaeshell.ps1" -Quiet -Uninstall -ShellRoot "${KSS_XAE64}"'
      Pop $0
    ${EndIf}
    ReadRegDWORD $0 SHCTX "${KSS_REG}" "TcXaeShell4024"
    ${If} $0 == 1
      DetailPrint "Removing the TcXaeShell (TwinCAT 4024) extension..."
      nsExec::ExecToLog '${KSS_PS} "$INSTDIR\installer\install-tcxaeshell.ps1" -Quiet -Uninstall -ShellRoot "${KSS_XAE32}"'
      Pop $0
    ${EndIf}
    ; Link's start at sign-in (this user's)
    SetShellVarContext current
    Delete "$SMSTARTUP\Kval MachineScope Link.lnk"
    ${If} $installMode == "all"
      SetShellVarContext all
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
      Delete "$SMPROGRAMS\Kval MachineScope Gateway.lnk"
    ${EndIf}
    DeleteRegKey SHCTX "${KSS_REG}"
  ${EndIf}
!macroend
