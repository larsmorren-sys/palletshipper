import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const loader = new URL('./env.js', import.meta.url).href;
function run(directory, overrides = {}) {
  const env = { ...process.env, ...overrides };
  delete env.PALLET_ENV_TEST_LOCAL;
  return spawnSync(process.execPath, ['--import', loader, '--input-type=module', '-e', "console.log(JSON.stringify({local:process.env.PALLET_ENV_TEST_LOCAL,platform:process.env.PALLET_ENV_TEST_PLATFORM}));"], { cwd:directory, env, encoding:'utf8' });
}

test('Optional env loading is quiet without a file and platform variables take precedence', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'pallet-env-'));
  try {
    const absent = run(directory, { PALLET_ENV_TEST_PLATFORM:'railway' });
    assert.equal(absent.status,0);
    assert.equal(absent.stderr,'');
    assert.deepEqual(JSON.parse(absent.stdout),{platform:'railway'});
    writeFileSync(path.join(directory,'.env'),'PALLET_ENV_TEST_LOCAL="local value"\nPALLET_ENV_TEST_PLATFORM=from-file\n');
    const present = run(directory, { PALLET_ENV_TEST_PLATFORM:'railway' });
    assert.equal(present.status,0);
    assert.equal(present.stderr,'');
    assert.deepEqual(JSON.parse(present.stdout),{local:'local value',platform:'railway'});
  } finally { rmSync(directory,{recursive:true,force:true}); }
});

test('Optional env loading does not hide file access errors', () => {
  const directory = mkdtempSync(path.join(tmpdir(),'pallet-env-'));
  try {
    mkdirSync(path.join(directory,'.env'));
    const result = run(directory);
    assert.notEqual(result.status,0);
    assert.match(result.stderr,/EISDIR|ERR_INVALID_ARG_TYPE/);
  } finally { rmSync(directory,{recursive:true,force:true}); }
});
