import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const cacheDir = join(homedir(), '.cache', 'afk-icon-detector-benchmark');
const venvDir = join(cacheDir, '.venv');
const isWin = process.platform === 'win32';
const venvPython = isWin
  ? join(venvDir, 'Scripts', 'python.exe')
  : join(venvDir, 'bin', 'python');

mkdirSync(cacheDir, { recursive: true });

if (!existsSync(venvPython)) {
  const candidates = isWin
    ? ['python']
    : ['python3.12', 'python3.11', 'python3.10', 'python3'];
  const sysPython =
    candidates.find(
      (cmd) => spawnSync(cmd, ['-c', 'import lzma, venv'], { stdio: 'ignore' }).status === 0,
    ) ?? (isWin ? 'python' : 'python3');
  console.log(`[setup:api] Creating Python venv at ${venvDir} using ${sysPython}...`);
  const res = spawnSync(sysPython, ['-m', 'venv', venvDir], { stdio: 'inherit' });
  if (res.status !== 0) {
    process.exit(res.status ?? 1);
  }
}

console.log('[setup:api] Installing image-recognition Python dependencies...');
const pipRes = spawnSync(
  venvPython,
  ['-m', 'pip', 'install', '--upgrade', 'pip', '-r', 'tools/image-recognition/requirements.txt'],
  { stdio: 'inherit' },
);
process.exit(pipRes.status ?? 0);
