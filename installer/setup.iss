#define ProductName "Terrorist NetworkTest"
#define InstallFolderName "TerroristNetWorkTest"
#define ProductVersion "1.3.0"
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
DisableDirPage=no
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
VersionInfoVersion=1.3.0.0
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

var
  PreviousInstallDir: String;

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

procedure InitializeWizard();
begin
  if not ReadPreviousInstallDir(PreviousInstallDir) then
    PreviousInstallDir := '';
end;

function CopyDataDirectory(const SourceDir, DestinationDir: String): Boolean;
var
  FindRec: TFindRec;
  SourcePath: String;
  DestinationPath: String;
begin
  Result := True;
  if not DirExists(DestinationDir) and not ForceDirectories(DestinationDir) then begin
    Result := False;
    Exit;
  end;

  if FindFirst(AddBackslash(SourceDir) + '*', FindRec) then begin
    try
      repeat
        if (FindRec.Name <> '.') and (FindRec.Name <> '..') then begin
          SourcePath := AddBackslash(SourceDir) + FindRec.Name;
          DestinationPath := AddBackslash(DestinationDir) + FindRec.Name;
          if (FindRec.Attributes and FILE_ATTRIBUTE_DIRECTORY) <> 0 then begin
            if (FindRec.Attributes and FILE_ATTRIBUTE_REPARSE_POINT) = 0 then
              if not CopyDataDirectory(SourcePath, DestinationPath) then
                Result := False;
          end else if not FileExists(DestinationPath) then begin
            if not CopyFile(SourcePath, DestinationPath, True) then
              Result := False;
          end;
        end;
      until not FindNext(FindRec);
    finally
      FindClose(FindRec);
    end;
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  PreviousDataDirectory: String;
  NewDataDirectory: String;
begin
  if (CurStep = ssPostInstall) and (PreviousInstallDir <> '') and
     (not PathSame(PreviousInstallDir, ExpandConstant('{app}'))) then begin
    PreviousDataDirectory := AddBackslash(PreviousInstallDir) + 'data';
    NewDataDirectory := ExpandConstant('{app}\data');
    if DirExists(PreviousDataDirectory) then begin
      if CopyDataDirectory(PreviousDataDirectory, NewDataDirectory) then
        Log('Copied missing application data from the previous install directory.')
      else begin
        Log('Some application data could not be copied from the previous install directory.');
        MsgBox('部分旧版数据未能复制到新目录。旧安装目录中的 data 文件夹仍保留，请检查文件权限后再试。', mbError, MB_OK);
      end;
    end;
  end;
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
