import { spawn } from 'node:child_process';
const backend = spawn(process.execPath, ['--watch', 'server/index.js'], { stdio: 'inherit' });
const frontend = spawn(process.execPath, ['node_modules/vite/bin/vite.js'], { stdio: 'inherit' });
let stopping = false;
function stop(code = 0) { if (stopping) return; stopping = true; backend.kill(); frontend.kill(); process.exitCode = code; }
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
backend.on('exit', code => stop(code || 0));
frontend.on('exit', code => stop(code || 0));
