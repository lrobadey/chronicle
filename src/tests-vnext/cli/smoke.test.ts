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

async function runCliSmoke(inputScript: string, extraEnv: Record<string, string>, args: string[] = []) {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const cliPath = path.resolve(process.cwd(), '.tmp-tests/cli.js');

  const child = spawn(process.execPath, [cliPath, ...args], {
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
  it('drives play mode through a non-tty harness with operator commands', async () => {
    const sessionRoot = await makeTempDir('chronicle-cli-smoke-');
    const transcriptPath = path.join(sessionRoot, 'transcript.jsonl');

    const result = await runCliSmoke(':inspect state\nlook around\n:exit\n', {
      CHRONICLE_ALLOW_NON_TTY: '1',
      CHRONICLE_API_MODE: 'fallback',
      CHRONICLE_SESSION_ROOT: sessionRoot,
      CHRONICLE_CLI_TRANSCRIPT: transcriptPath,
      NODE_NO_WARNINGS: '1',
    });

    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes('## Chronicle Play'));
    assert.ok(result.stdout.includes('world=Isle of Marrow'));
    assert.ok(result.stdout.includes('Type `:help` for operator commands, or enter your action.'));
    assert.ok(result.stdout.includes('## Session'));
    assert.ok(result.stdout.includes('location: The Landing'));
    assert.ok(result.stdout.includes('[route] simple_council'));
    assert.ok(result.stdout.includes('[dispatch] systems, world'));
    assert.ok(result.stdout.includes('Hint: :inspect trace --view full | :inspect council | :inspect route'));

    const sessionEntries = await fs.readdir(sessionRoot, { withFileTypes: true });
    const sessionDir = sessionEntries.find(entry => entry.isDirectory());
    assert.ok(sessionDir);
    const sessionFiles = await fs.readdir(path.join(sessionRoot, sessionDir!.name));
    assert.ok(sessionFiles.includes('initial.json'));
    assert.ok(sessionFiles.includes('snapshot.json'));

    const transcript = await fs.readFile(transcriptPath, 'utf8');
    assert.ok(transcript.includes('"type":"prompt"'));
    assert.ok(transcript.includes('"type":"input","text":":inspect state"'));
    assert.ok(transcript.includes('"type":"input","text":"look around"'));
    assert.ok(transcript.includes('"type":"output","text":"## Chronicle Play'));
  });

  it('boots the tel-mora startup world when requested by script env', async () => {
    const sessionRoot = await makeTempDir('chronicle-cli-smoke-tel-mora-');

    const result = await runCliSmoke(':exit\n', {
      CHRONICLE_ALLOW_NON_TTY: '1',
      CHRONICLE_API_MODE: 'fallback',
      CHRONICLE_SESSION_ROOT: sessionRoot,
      CHRONICLE_STARTUP_WORLD_ID: 'tel-mora',
      NODE_NO_WARNINGS: '1',
    });

    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes('world=Tel Mora — The Dead Junction'));
    assert.ok(result.stdout.includes("You come in at first light at The Assessor's Shade"));
    assert.ok(result.stdout.includes('Type `:help` for operator commands, or enter your action.'));
  });

  it('runs one-shot explain commands without interactive play', async () => {
    const sessionRoot = await makeTempDir('chronicle-cli-smoke-explain-');

    const result = await runCliSmoke('', {
      CHRONICLE_API_MODE: 'fallback',
      CHRONICLE_SESSION_ROOT: sessionRoot,
      NODE_NO_WARNINGS: '1',
    }, ['turn', 'explain', 'look around', '--world', 'tel-mora']);

    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes('## Explain'));
    assert.ok(result.stdout.includes('world: Tel Mora — The Dead Junction (tel-mora)'));
    assert.ok(result.stdout.includes('classification: simple_council'));
    assert.ok(result.stdout.includes('required_domains: systems'));
  });
});
