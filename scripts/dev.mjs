import { spawn } from 'node:child_process';
const children = [
  spawn(process.execPath, ['--env-file-if-exists=.env', 'server/index.js'], { stdio: 'inherit' }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1'], { stdio: 'inherit' })
];
let exiting = false;
function stop(code = 0) {
  if (exiting) return;
  exiting = true;
  children.forEach(child => child.kill('SIGTERM'));
  setTimeout(() => process.exit(code), 300).unref();
}
children.forEach(child => {
  child.on('error', error => { console.error(error.message); stop(1); });
  child.on('exit', code => { if (!exiting) stop(code || 0); });
});
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
