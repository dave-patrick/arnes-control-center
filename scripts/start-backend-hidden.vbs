Option Explicit

Dim shell, fso, projectRoot, nodePath, command
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
projectRoot = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
nodePath = shell.ExpandEnvironmentStrings("%ProgramFiles%") & "\nodejs\node.exe"
If Not fso.FileExists(nodePath) Then nodePath = "node"
command = """" & nodePath & """ """" & projectRoot & "\app\local-server.cjs""""
shell.CurrentDirectory = projectRoot
shell.Run command, 0, False
