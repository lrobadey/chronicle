import { spawn } from 'node:child_process';

function run(cmd: string, args: string[]) {
  const child = spawn(cmd, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  child.on('error', error => {
    console.error(`Failed to start ${cmd} ${args.join(' ')}:`, error);
    process.exitCode = 1;
  });

  return child;
}

const apiServer = run('npm', ['run', 'server']);
const webClient = run('npm', ['run', 'web', '--', '--open']);

let shuttingDown = false;

function shutdown(signal: NodeJS.Signals) {
  if (shuttingDown) return;
  shuttingDown = true;
  apiServer.kill(signal);
  webClient.kill(signal);
  setTimeout(() => process.exit(0), 50);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

webClient.on('exit', code => {
  if (!shuttingDown) {
    apiServer.kill('SIGTERM');
    process.exit(code ?? 0);
  }
});

apiServer.on('exit', code => {
  if (!shuttingDown && code && code !== 0) {
    webClient.kill('SIGTERM');
    process.exit(code);
  }
});
