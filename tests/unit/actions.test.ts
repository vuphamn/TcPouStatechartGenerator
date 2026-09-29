// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// A POU's actions: listed, opened and saved in the Method Editor like methods (no declaration of their own),
// renamed with their calls; a property renamed too
import { getActionsFromPou, getMethodCodeFromPou, updateMethodCodeInPou } from '../../src/utils/pouStateEditor.ts';
import { renameMethod } from '../../src/utils/renameVariable.ts';

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const cdata = (s: string) => `<![CDATA[${s}]]>`;
const POU = `<?xml version="1.0" encoding="utf-8"?>
<TcPlcObject Version="1.1.0.1">
  <POU Name="SM_A" Id="{1}" SpecialFunc="None">
    <Declaration>${cdata('FUNCTION_BLOCK SM_A\nVAR\n\tnCount : INT;\nEND_VAR')}</Declaration>
    <Implementation>
      <ST>${cdata('doState();\nResetAll();\nIF bReady THEN\n\tnCount := 0;\nEND_IF')}</ST>
    </Implementation>
    <Method Name="doState" Id="{2}">
      <Declaration>${cdata('METHOD doState : BOOL')}</Declaration>
      <Implementation>
        <ST>${cdata('ResetAll();\nTHIS^.ResetAll();')}</ST>
      </Implementation>
    </Method>
    <Action Name="ResetAll" Id="{3}">
      <Implementation>
        <ST>${cdata('nCount := 0;')}</ST>
      </Implementation>
    </Action>
    <Property Name="bReady" Id="{4}">
      <Declaration>${cdata('PROPERTY bReady : BOOL')}</Declaration>
      <Get Name="Get" Id="{5}">
        <Declaration>${cdata('VAR\nEND_VAR')}</Declaration>
        <Implementation>
          <ST>${cdata('bReady := nCount > 3;')}</ST>
        </Implementation>
      </Get>
    </Property>
  </POU>
</TcPlcObject>`;

// 1. Listed; opened like a method (its code, no declaration)
expect(getActionsFromPou(POU).join() === 'ResetAll', `actions: ${getActionsFromPou(POU).join()}`);
const m = getMethodCodeFromPou(POU, 'ResetAll()');
expect(m.methodFound && m.code === 'nCount := 0;' && m.declaration === '', `opened: "${m.code}" (declaration "${m.declaration}")`);

// 2. Saved: its code only (a declaration is not added to an action)
const u = updateMethodCodeInPou(POU, 'ResetAll', 'nCount := 1;', 'METHOD ResetAll');
const after = getMethodCodeFromPou(u.updatedPou, 'ResetAll');
expect(u.success && after.code === 'nCount := 1;' && !/<Action Name="ResetAll"[^>]*>\s*<Declaration>/.test(u.updatedPou) && !/<Method Name="ResetAll"/.test(u.updatedPou), 'saved: the code, still an action, no declaration');

// 3. Renamed: the element and its calls (x(, THIS^.x()
const r = renameMethod(POU, 'ResetAll', 'ClearAll');
expect(!('error' in r) && r.kind === 'action' && /<Action Name="ClearAll"/.test(r.pou) && !/ResetAll/.test(r.pou) && r.changes.length === 3, `action renamed: ${'error' in r ? r.error : `${r.kind}, ${r.changes.length} changes`}`);

// 4. A property renamed: its element and its uses
const p = renameMethod(POU, 'bReady', 'bIsReady');
expect(!('error' in p) && p.kind === 'property' && /<Property Name="bIsReady"/.test(p.pou) && /IF bIsReady THEN/.test(p.pou) && /bIsReady := nCount > 3;/.test(p.pou), `property renamed: ${'error' in p ? p.error : p.kind}`);

console.log(`${fails} failures`);
process.exit(fails ? 1 : 0);
