import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..', '..');
const CLI_ENTRY = path.resolve(ROOT, 'v3/cli.ts');
const TSX_BIN = path.resolve(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');

interface RunCliOptions {
  env?: Record<string, string>;
}

async function runCliSession(commands: string[], options: RunCliOptions = {}) {
  const child = spawn(process.execPath, [TSX_BIN, CLI_ENTRY], {
    cwd: ROOT,
    stdio: 'pipe',
    env: {
      ...process.env,
      OPENAI_API_KEY: '',
      VITE_OPENAI_API_KEY: '',
      GM_ENGINE: 'openai',
      CHRONICLE_CLI_ACTIVITY: 'off',
      CHRONICLE_CLI_SUMMARY: 'off',
      CHRONICLE_CLI_PATCHES: 'off',
      NODE_ENV: 'test',
      ...options.env,
    },
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  await waitForText(() => stdout, 'Ready! Type your first action or command.', child);

  for (const cmd of commands) {
    child.stdin.write(`${cmd}\n`);
  }

  const exitCode: number = await once(child, 'exit').then(([code]) => (code == null ? 0 : Number(code)));
  child.stdin.end();

  return { stdout, stderr, exitCode };
}

function waitForText(buffer: () => string, needle: string | RegExp, child: ReturnType<typeof spawn>, timeout = 15000) {
  return new Promise<void>((resolve, reject) => {
    const start = Date.now();
    const timer = setInterval(() => {
      const data = buffer();
      const found = typeof needle === 'string' ? data.includes(needle) : needle.test(data);
      if (found) {
        clearInterval(timer);
        resolve();
        return;
      }
      if ((child.exitCode ?? null) !== null) {
        clearInterval(timer);
        reject(new Error(`CLI exited before emitting "${needle}". Output:\n${data}`));
        return;
      }
      if (Date.now() - start > timeout) {
        clearInterval(timer);
        reject(new Error(`Timeout waiting for CLI output "${needle}". Output so far:\n${data}`));
      }
    }, 50);
  });
}

async function testBasicFlow() {
  console.log('🧪  CLI basic fallback flow');
  const { stdout, exitCode } = await runCliSession(['look around', '/state', '/exit']);
  if (exitCode !== 0) {
    throw new Error(`CLI exited with code ${exitCode}`);
  }
  expectText(stdout, 'Ready! Type your first action or command.');
  expectText(stdout, 'You steady your breath and take it in');
  expectText(stdout, '=== Current World State ===');
  expectText(stdout, 'Goodbye!');
  console.log('   ✓ basic flow ok');
}

async function testRuntimeCommands() {
  console.log('🧪  CLI runtime commands and toggles');
  const { stdout, exitCode } = await runCliSession(
    ['/help', '/toggle patches', 'look', '/history', '/exit'],
    { env: { CHRONICLE_CLI_ACTIVITY: 'off' } }
  );
  if (exitCode !== 0) {
    throw new Error(`CLI exited with code ${exitCode}`);
  }
  expectText(stdout, 'Runtime Commands:');
  expectText(stdout, 'Patches Display: ON');
  expectText(stdout, 'You steady your breath and take it in');
  expectText(stdout, '=== Conversation History ===');
  expectText(stdout, 'Goodbye!');
  console.log('   ✓ runtime commands ok');
}

function expectText(haystack: string, needle: string) {
  if (!haystack.includes(needle)) {
    throw new Error(`Expected CLI output to include "${needle}". Got:\n${haystack}`);
  }
}

async function main() {
  await testBasicFlow();
  await testRuntimeCommands();
  console.log('\n✅ CLI smoke tests passed');
}

main().catch((err) => {
  console.error('\n❌ CLI smoke tests failed:', err);
  process.exit(1);
});

