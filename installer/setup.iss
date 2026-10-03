#define ProductName "Terrorist NetworkTest"
#define InstallFolderName "TerroristNetWorkTest"
#define ProductVersion "1.0.0"
#define ProductGuid "dfea1301-fb94-51e1-a8c2-b661e54f3b53"

[Setup]
AppId={{{#ProductGuid}}}
AppName={#ProductName}
AppVersion={#ProductVersion}
AppVerName={#ProductName} {#ProductVersion}
AppPublisher=Terrorist NetworkTest contributors
DefaultDirName={code:GetDefaultInstallDir}
DefaultGroupName={#ProductName}
AppendDefaultDirName=yes
DisableProgramGroupPage=yes
DisableDirPage=auto
UsePreviousAppDir=yes
Uninstallable=yes
UninstallDisplayName={#ProductName}
UninstallDisplayIcon={app}\TerroristNetWorkTest.exe
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64
SetupIconFile=..\resources\app.ico
WizardStyle=modern
Compression=lzma2/ultra64
SolidCompression=yes
OutputDir=..\release
OutputBaseFilename=Terrorist NetworkTest {#ProductVersion}
VersionInfoVersion=1.0.0.0
VersionInfoProductName={#ProductName}
VersionInfoProductVersion={#ProductVersion}
CloseApplications=yes
RestartApplications=no
DisableWelcomePage=no

[Languages]
Name: "chinesesimp"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"

[InstallDelete]
; Remove the old NSIS uninstaller after its registry location has been captured.
Type: files; Name: "{app}\Uninstall TerroristNetWorkTest.exe"
Type: files; Name: "{app}\uninstallerIcon.ico"

[UninstallDelete]
; Application settings, history, Chromium state, crash dumps, and app temp files.
Type: filesandordirs; Name: "{app}\data"

[Files]
Source: "..\release\win-unpacked\*"; DestDir: "{app}"; Excludes: "data\*"; Flags: ignoreversion recursesubdirs createallsubdirs

[Registry]
; electron-builder used this key for the previous NSIS installer. Keeping it lets
; the first Inno release find the existing folder; later releases use AppId data.
Root: HKCU; Subkey: "Software\{#ProductGuid}"; ValueType: string; ValueName: "InstallLocation"; ValueData: "{app}"; Flags: uninsdeletekey

[Code]
const
  PreviousInstallKey = 'Software\{#ProductGuid}';
  PreviousUninstallKey = 'Software\Microsoft\Windows\CurrentVersion\Uninstall\{#ProductGuid}_is1';

function ReadPreviousInstallDir(var InstallDir: String): Boolean;
begin
  Result := RegQueryStringValue(HKCU, PreviousInstallKey, 'InstallLocation', InstallDir);
  if not Result then
    Result := RegQueryStringValue(HKCU, PreviousUninstallKey, 'InstallLocation', InstallDir);
  if not Result then
    Result := RegQueryStringValue(HKLM, PreviousInstallKey, 'InstallLocation', InstallDir);
  if not Result then
    Result := RegQueryStringValue(HKLM, PreviousUninstallKey, 'InstallLocation', InstallDir);
end;

function GetDefaultInstallDir(Param: String): String;
var
  PreviousDir: String;
begin
  if ReadPreviousInstallDir(PreviousDir) and (PreviousDir <> '') then
    Result := PreviousDir
  else
    Result := ExpandConstant('{localappdata}\Programs\{#InstallFolderName}');
end;
