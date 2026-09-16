# TcPouStatechartGenerator

Generates a [Mermaid](https://mermaid.js.org/) `stateDiagram-v2` (written to a
`.statechart.md` file) from a Beckhoff TwinCAT PLC state machine.

The tool parses the `doState()` and `preProcess()` methods of a `SM_*.TcPOU`
file together with the enum declared in the matching `E_*_States.TcDUT` file. If
the POU contains a `doState_UmlSC()` method, its UML data is used to derive the
composite (nested) state grouping; otherwise grouping is inferred from the enum
declaration order and naming conventions (states after `*_ENABLING` are placed
inside the `*Enabled` composite).

## Requirements

- Windows x64 (the app is a Windows Forms application).
- [.NET 8 SDK](https://dotnet.microsoft.com/download/dotnet/8.0) to build.
  A published build is self-contained, so the .NET runtime is **not** required
  on machines that only run the produced executable.

## Build

From the repository root (`C:\dev\tools\TcPouStatechartGenerator`):

```powershell
dotnet build TcPouStatechartGenerator\TcPouStatechartGenerator.csproj -c Debug
```

For an optimized build:

```powershell
dotnet build TcPouStatechartGenerator\TcPouStatechartGenerator.csproj -c Release
```

## Install (publish a standalone executable)

The project is configured for a self-contained, single-file `win-x64` publish:

```powershell
dotnet publish TcPouStatechartGenerator\TcPouStatechartGenerator.csproj -c Release
```

The resulting single `TcPouStatechartGenerator.exe` is written to:

```
TcPouStatechartGenerator\bin\Release\net8.0-windows\win-x64\publish\
```

To "install", copy that `TcPouStatechartGenerator.exe` anywhere you like (for
example a folder on your `PATH`). No other files are needed.

## Run

### GUI mode

Launch the executable with no arguments:

```powershell
& "TcPouStatechartGenerator\bin\Release\net8.0-windows\win-x64\publish\TcPouStatechartGenerator.exe"
```

Then:

1. Drag & drop a `.TcDUT` (states) file and a `.TcPOU` (POU) file anywhere on
   the window, or use the **Browse...** buttons.
2. Optionally change the output `.md` path (defaults next to the `.TcPOU`).
3. Click **Generate**.

### Headless / command-line mode

Pass both input files as arguments to generate the diagram without showing the
GUI. The two files are recognized by extension, so order does not matter:

```powershell
& "TcPouStatechartGenerator\bin\Debug\net8.0-windows\win-x64\TcPouStatechartGenerator.exe" `
	"path\to\E_MyMachine_States.TcDUT" `
	"path\to\SM_MyMachine.TcPOU"
```

The output `.md` file is written next to the `.TcPOU` file, named
`<POU name>.statechart.md` (e.g. `SM_MyMachine.statechart.md`), and a
confirmation dialog reports the output path.

You can also run directly through the SDK during development:

```powershell
dotnet run --project TcPouStatechartGenerator\TcPouStatechartGenerator.csproj -- `
	"path\to\E_MyMachine_States.TcDUT" `
	"path\to\SM_MyMachine.TcPOU"
```

## Viewing the output

The generated `.statechart.md` file contains a fenced ```` ```mermaid ```` code
block. View it in any Markdown renderer that supports Mermaid (for example
GitHub, or Visual Studio Code with a Mermaid preview extension).

## Samples

Example input and generated output files are available under
`TcPouStatechartGenerator\Samples\`, including:

- `E_DoorDasher_States.TcDUT` / `SM_DoorDasher.TcPOU` / `SM_DoorDasher.statechart.md`
- `E_TableManager_States.TcDUT` / `SM_TableManager.TcPOU` / `SM_TableManager.statechart.md`
- `E_KMotorVFD_States.TcDUT` / `SM_KMotorVFDEtherCATi550.TcPOU` / `SM_KMotorVFDEtherCATi550.statechart.md`
"# TcPouStatechartGenerator" 
