import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

// Explicit test roots keep scratch worktrees and archived release snapshots out.
const files = [];
function collect(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) collect(file);
    else if (entry.isFile() && entry.name.endsWith('.test.js')) files.push(file);
  }
}
collect('tests');
const child = spawn(process.execPath, ['--test', ...process.argv.slice(2), ...files.sort()], { stdio: 'inherit' });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', (code, signal) => { process.exitCode = signal ? 1 : code || 0; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
