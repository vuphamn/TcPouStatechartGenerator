// New TwinCAT objects, as XAE writes them (no vscode here: tested on its own): a POU (function block, program,
// function) or a DUT (struct, enum, alias) as a file of its own; a method or property put into a POU; a file added to
// its PLC project (.plcproj: Compile Include, its folder). Each object with a new GUID; CRLF, as XAE writes them.
'use strict';
const crypto = require('crypto');

const guid = () => `{${crypto.randomUUID()}}`;
const crlf = (s) => s.replace(/\r?\n/g, '\r\n');
const NAME_RX = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** A TwinCAT object's name: letters, digits, single underscores, not starting with a digit */
function checkName(name) {
  if (!NAME_RX.test(name || '') || /__/.test(name)) return 'Letters, digits and single underscores, not starting with a digit';
  return null;
}

/** A new POU's file: kind 'FUNCTION_BLOCK' | 'PROGRAM' | 'FUNCTION'; a function's return type */
function newPouXml(kind, name, { returnType = 'BOOL', extendsName = '' } = {}) {
  const header = kind === 'FUNCTION' ? `FUNCTION ${name} : ${returnType}` : `${kind} ${name}${extendsName && kind === 'FUNCTION_BLOCK' ? ` EXTENDS ${extendsName}` : ''}`;
  const vars = kind === 'FUNCTION_BLOCK' ? 'VAR_INPUT\nEND_VAR\nVAR_OUTPUT\nEND_VAR\nVAR\nEND_VAR\n' : kind === 'FUNCTION' ? 'VAR_INPUT\nEND_VAR\nVAR\nEND_VAR\n' : 'VAR\nEND_VAR\n';
  return crlf(`<?xml version="1.0" encoding="utf-8"?>
<TcPlcObject Version="1.1.0.1">
  <POU Name="${name}" Id="${guid()}" SpecialFunc="None">
    <Declaration><![CDATA[${header}
${vars}]]></Declaration>
    <Implementation>
      <ST><![CDATA[]]></ST>
    </Implementation>
  </POU>
</TcPlcObject>`);
}

/** A new DUT's file: kind 'STRUCT' | 'ENUM' | 'ALIAS'; members (an enum's: its names; a struct's: "a : INT") */
function newDutXml(kind, name, { members = [], aliasOf = 'INT' } = {}) {
  let body;
  if (kind === 'ENUM') body = `{attribute 'qualified_only'}\n{attribute 'strict'}\nTYPE ${name} :\n(\n${(members.length ? members : ['Idle']).map((m, i, a) => `\t${m}${i === 0 ? ' := 0' : ''}${i < a.length - 1 ? ',' : ''}`).join('\n')}\n);\nEND_TYPE\n`;
  else if (kind === 'ALIAS') body = `TYPE ${name} : ${aliasOf};\nEND_TYPE\n`;
  else body = `TYPE ${name} :\nSTRUCT\n${members.map((m) => `\t${m};`).join('\n')}${members.length ? '\n' : ''}END_STRUCT\nEND_TYPE\n`;
  return crlf(`<?xml version="1.0" encoding="utf-8"?>
<TcPlcObject Version="1.1.0.1">
  <DUT Name="${name}" Id="${guid()}">
    <Declaration><![CDATA[${body}]]></Declaration>
  </DUT>
</TcPlcObject>`);
}

/** Where a POU's methods and properties go: before its closing </POU> (after its own implementation, its others) */
function insertBeforePouEnd(xml, block) {
  const at = xml.lastIndexOf('</POU>');
  if (at < 0) throw new Error('Not a POU file (no </POU>)');
  // (its indentation: the lines of a member, two spaces deeper than <POU>)
  const nl = xml.includes('\r\n') ? '\r\n' : '\n';
  const lineStart = xml.lastIndexOf('\n', at) + 1;
  return xml.slice(0, lineStart) + block.replace(/\r?\n/g, nl) + nl + xml.slice(lineStart);
}
const memberNames = (xml) => [...xml.matchAll(/<(Method|Property|Action|Transition)\s+Name="([^"]+)"/g)].map((m) => m[2].toLowerCase());

/** A POU with a new method: its return type ('' for none), its access (PUBLIC, PRIVATE, PROTECTED, INTERNAL) */
function addMethod(xml, name, { returnType = '', access = '' } = {}) {
  if (memberNames(xml).includes(name.toLowerCase())) throw new Error(`${name} is already a member of this POU`);
  const header = `METHOD ${access ? `${access} ` : ''}${name}${returnType ? ` : ${returnType}` : ''}`;
  return insertBeforePouEnd(xml, `    <Method Name="${name}" Id="${guid()}">
      <Declaration><![CDATA[${header}
VAR_INPUT
END_VAR
]]></Declaration>
      <Implementation>
        <ST><![CDATA[]]></ST>
      </Implementation>
    </Method>`);
}

/** A POU with a new property: its type; a Get and a Set (one of them may be left out) */
function addProperty(xml, name, { type = 'BOOL', get = true, set = true, access = '' } = {}) {
  if (memberNames(xml).includes(name.toLowerCase())) throw new Error(`${name} is already a member of this POU`);
  const accessor = (which) => `      <${which} Name="${which}" Id="${guid()}">
        <Declaration><![CDATA[VAR
END_VAR
]]></Declaration>
        <Implementation>
          <ST><![CDATA[]]></ST>
        </Implementation>
      </${which}>`;
  return insertBeforePouEnd(xml, [`    <Property Name="${name}" Id="${guid()}">`, `      <Declaration><![CDATA[PROPERTY ${access ? `${access} ` : ''}${name} : ${type}]]></Declaration>`, ...(get ? [accessor('Get')] : []), ...(set ? [accessor('Set')] : []), '    </Property>'].join('\n'));
}

/** The .plcproj with a file added (relPath: POUs\Folder\FB_X.TcPOU) and its folders; unchanged when already there */
function addToPlcproj(proj, relPath) {
  const rel = relPath.replace(/\//g, '\\');
  if (new RegExp(`<Compile\\s+Include="${rel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`, 'i').test(proj)) return proj;
  const nl = proj.includes('\r\n') ? '\r\n' : '\n';
  // (an empty project written <Project/>: opened, its items put in)
  proj = proj.replace(/<Project(\s[^>]*)?\/>/, (m, attrs = '') => `<Project${attrs}>${nl}</Project>`);
  const compile = `    <Compile Include="${rel}">${nl}      <SubType>Code</SubType>${nl}    </Compile>${nl}`;
  // (after the last Compile; else in a new ItemGroup before </Project>)
  const lastCompile = [...proj.matchAll(/<Compile\s+Include="[^"]*"\s*(?:\/>|>[\s\S]*?<\/Compile>)\r?\n/g)].pop();
  let out = lastCompile ? proj.slice(0, lastCompile.index + lastCompile[0].length) + compile + proj.slice(lastCompile.index + lastCompile[0].length) : proj.replace(/<\/Project>/, `  <ItemGroup>${nl}${compile}  </ItemGroup>${nl}</Project>`);
  // Its folders (each level), when not listed
  const parts = rel.split('\\').slice(0, -1);
  for (let i = 1; i <= parts.length; i++) {
    const folder = parts.slice(0, i).join('\\');
    if (new RegExp(`<Folder\\s+Include="${folder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`, 'i').test(out)) continue;
    const lastFolder = [...out.matchAll(/<Folder\s+Include="[^"]*"\s*\/>\r?\n/g)].pop();
    const line = `    <Folder Include="${folder}" />${nl}`;
    out = lastFolder ? out.slice(0, lastFolder.index + lastFolder[0].length) + line + out.slice(lastFolder.index + lastFolder[0].length) : out.replace(/<\/Project>/, `  <ItemGroup>${nl}${line}  </ItemGroup>${nl}</Project>`);
  }
  return out;
}

module.exports = { checkName, newPouXml, newDutXml, addMethod, addProperty, addToPlcproj };
