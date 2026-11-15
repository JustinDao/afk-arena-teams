import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Ensure environment.ts exists so Angular can build without manual setup
const envPath = join(process.cwd(), 'src', 'environments', 'environment.ts');
const envExamplePath = join(process.cwd(), 'src', 'environments', 'environment.example.ts');
if (!existsSync(envPath) && existsSync(envExamplePath)) {
  copyFileSync(envExamplePath, envPath);
  console.log('[dev-start] Created src/environments/environment.ts from environment.example.ts');
}

const venvPython = join(homedir(), '.cache', 'afk-icon-detector-benchmark', '.venv', 'bin', 'python');
const pythonBin = existsSync(venvPython) ? venvPython : 'python3';

let apiProc = null;
const hasCv2 = spawnSync(pythonBin, ['-c', 'import cv2'], { stdio: 'ignore' }).status === 0;

if (hasCv2) {
  apiProc = spawn(pythonBin, ['api/recognize-lineup.py', '--serve', '--port', '8174'], {
    stdio: 'inherit',
  });

  apiProc.on('error', (err) => {
    console.warn(`[dev-start] Recognition API failed to start (${err.message}); continuing with ng serve only.`);
    apiProc = null;
  });
} else {
  console.warn('[dev-start] Python cv2 module not found; continuing with ng serve only.');
  console.warn('[dev-start] (Optional) Set up Python dependencies to enable /submit/from-image recognition API.');
}

const ngProc = spawn('npx', ['ng', 'serve'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

function shutdown(signal) {
  if (apiProc && !apiProc.killed) apiProc.kill(signal);
  if (!ngProc.killed) ngProc.kill(signal);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

ngProc.on('exit', (code) => {
  if (apiProc && !apiProc.killed) apiProc.kill('SIGTERM');
  process.exit(code ?? 0);
});
