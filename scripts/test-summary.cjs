#!/usr/bin/env node
// The tests' results for a CI run's summary page ($GITHUB_STEP_SUMMARY): each failed test file with its failed checks
// (and the error that stopped it), then the screenshots the run left (in the test-output artifact).
//   node scripts/test-summary.cjs [title] >> "$GITHUB_STEP_SUMMARY"
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'tests', '.output');
const LOGS = path.join(OUT, 'logs');
const title = process.argv[2] || 'Tests';
const lines = [`## ${title}`];

const logs = fs.existsSync(LOGS) ? fs.readdirSync(LOGS).filter((f) => f.endsWith('.log') && !/^vite/.test(f)).sort() : [];
const failed = [];
for (const f of logs) {
  const text = fs.readFileSync(path.join(LOGS, f), 'utf8');
  const fails = text.split(/\r?\n/).filter((l) => /^FAIL\b/.test(l));
  const error = text.split(/\r?\n/).find((l) => /^(\w*Error\b|Error \[)/.test(l));
  if (fails.length || error) failed.push({ name: f.replace(/\.log$/, ''), fails, error });
}

if (!logs.length) lines.push('', 'No test logs (the tests did not run).');
else if (!failed.length) lines.push('', `All ${logs.length} test files passed.`);
else {
  lines.push('', `${failed.length} of ${logs.length} test files failed:`, '');
  for (const t of failed) {
    lines.push(`- **${t.name}**`);
    for (const l of t.fails.slice(0, 8)) lines.push(`  - ${l.replace(/^FAIL\s*/, '').slice(0, 300).replace(/\|/g, '\\|')}`);
    if (t.fails.length > 8) lines.push(`  - … ${t.fails.length - 8} more`);
    if (t.error) lines.push(`  - stopped: \`${t.error.slice(0, 200).replace(/`/g, "'")}\``);
  }
}

const shots = fs.existsSync(OUT) ? fs.readdirSync(OUT).filter((f) => /\.png$/i.test(f)).sort() : [];
if (shots.length) lines.push('', `Screenshots (${shots.length}) are in the run's test-output artifact: ${shots.slice(0, 30).join(', ')}${shots.length > 30 ? ', …' : ''}`);

process.stdout.write(lines.join('\n') + '\n');
