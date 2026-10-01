// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// Open in Mermaid Live (src/utils/mermaidLive.ts): the link's state (pako) has the chart, its theme and layout, and no
// securityLevel anywhere (mermaid.live would ask in a dialog before it took "loose" out), an init directive's too
import pako from 'pako';
import { getMermaidLiveUrl, withoutSecurityLevel } from '../../src/utils/mermaidLive.ts';

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

const decode = (url: string) => {
  const b64 = url.split('#pako:')[1].replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(pako.inflate(bytes)));
};

const plain = decode(getMermaidLiveUrl('flowchart TD\n  A --> B', { theme: 'forest', layout: 'dagre' }));
expect(/A --> B/.test(plain.code) && /'theme': 'forest'/.test(plain.code) && JSON.parse(plain.mermaid).layout === 'dagre', 'the chart, its theme and layout');
expect(!/securityLevel/i.test(plain.code) && !/securityLevel/i.test(plain.mermaid), 'no securityLevel (in the code nor the config)');

const withInit = decode(getMermaidLiveUrl("%%{init: {'theme': 'dark', 'securityLevel': 'loose', 'flowchart': {'curve': 'basis'}}}%%\nflowchart TD\n  A --> B", { theme: 'neutral' }));
expect(!/securityLevel/i.test(withInit.code) && /'theme': 'neutral'/.test(withInit.code) && /'curve': 'basis'/.test(withInit.code), `an init directive's taken out, the rest kept (${withInit.code.split('\n')[0]})`);
expect(withoutSecurityLevel("%%{init: {'securityLevel': 'loose'}}%%") === '%%{init: {}}%%', `the only key: an empty init (${withoutSecurityLevel("%%{init: {'securityLevel': 'loose'}}%%")})`);

console.log(`${fails} failures`);
process.exit(fails ? 1 : 0);
