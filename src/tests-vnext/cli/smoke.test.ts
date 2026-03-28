import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function runCliSmoke(inputScript: string, extraEnv: Record<string, string>) {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const cliPath = path.resolve(process.cwd(), '.tmp-tests/cli.js');

  const child = spawn(process.execPath, [cliPath], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...extraEnv,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => stdoutChunks.push(chunk));
  child.stderr.on('data', chunk => stderrChunks.push(chunk));

  child.stdin.write(inputScript);
  child.stdin.end();

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', code => resolve(code));
  });

  return {
    exitCode,
    stdout: stdoutChunks.join(''),
    stderr: stderrChunks.join(''),
  };
}

describe('CLI smoke', () => {
  it('drives the compiled CLI entrypoint through a non-tty harness', async () => {
    const sessionRoot = await makeTempDir('chronicle-cli-smoke-');
    const transcriptPath = path.join(sessionRoot, 'transcript.jsonl');

    const result = await runCliSmoke('/state\nlook around\n/exit\n', {
      CHRONICLE_ALLOW_NON_TTY: '1',
      CHRONICLE_API_MODE: 'fallback',
      CHRONICLE_SESSION_ROOT: sessionRoot,
      CHRONICLE_CLI_TRANSCRIPT: transcriptPath,
      NODE_NO_WARNINGS: '1',
    });

    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes('=== Chronicle vNext - Isle of Marrow ==='));
    assert.ok(result.stdout.includes('Opening:'));
    assert.ok(result.stdout.includes('[Day 1, '));
    assert.ok(result.stdout.includes('Type /help for commands, or enter your action.'));
    assert.ok(result.stdout.includes('> '));
    assert.ok(result.stdout.includes('Location: The Landing'));
    assert.ok(result.stdout.includes('[turn] #1 "look around"'));
    assert.ok(result.stdout.includes('Narration:'));
    assert.ok(result.stdout.includes('Goodbye!'));

    const sessionEntries = await fs.readdir(sessionRoot, { withFileTypes: true });
    const sessionDir = sessionEntries.find(entry => entry.isDirectory());
    assert.ok(sessionDir);
    const sessionFiles = await fs.readdir(path.join(sessionRoot, sessionDir!.name));
    assert.ok(sessionFiles.includes('initial.json'));
    assert.ok(sessionFiles.includes('snapshot.json'));

    const transcript = await fs.readFile(transcriptPath, 'utf8');
    assert.ok(transcript.includes('"type":"prompt"'));
    assert.ok(transcript.includes('"type":"input","text":"look around"'));
  });
});
