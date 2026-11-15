import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const venvPython = join(homedir(), '.cache', 'afk-icon-detector-benchmark', '.venv', 'bin', 'python');
const pythonBin = existsSync(venvPython) ? venvPython : 'python3';

const apiProc = spawn(pythonBin, ['api/recognize-lineup.py', '--serve', '--port', '8174'], {
  stdio: 'inherit',
});

apiProc.on('error', (err) => {
  console.warn(`[dev-start] Recognition API failed to start (${err.message}); continuing with ng serve only.`);
});

const ngProc = spawn('npx', ['ng', 'serve'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

function shutdown(signal) {
  if (!apiProc.killed) apiProc.kill(signal);
  if (!ngProc.killed) ngProc.kill(signal);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

ngProc.on('exit', (code) => {
  if (!apiProc.killed) apiProc.kill('SIGTERM');
  process.exit(code ?? 0);
});
