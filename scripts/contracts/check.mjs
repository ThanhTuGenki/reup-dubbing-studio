import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), 'reup-contract-'));
const expectedRoot = join(temporary, 'expected');
const files = [
  'packages/api-contract/src/web.ts',
  'packages/api-contract/src/worker.ts',
  'packages/api-contract/src/schemas.ts',
  'packages/api-contract/schemas/index.json',
];

try {
  execFileSync('node', [join(root, 'scripts/contracts/generate.mjs')], {
    cwd: root,
    env: { ...process.env, CONTRACT_GENERATED_ROOT: expectedRoot },
    stdio: 'inherit',
  });
  const drift = files.filter((file) => {
    const expected = join(root, file);
    const generated = join(expectedRoot, file);
    return (
      !existsSync(generated) || readFileSync(expected, 'utf8') !== readFileSync(generated, 'utf8')
    );
  });
  const generatedSchemas = join(expectedRoot, 'packages/api-contract/schemas');
  const committedSchemas = join(root, 'packages/api-contract/schemas');
  const schemaFiles = [
    ...new Set([...listJsonFiles(generatedSchemas), ...listJsonFiles(committedSchemas)]),
  ].sort();
  for (const file of schemaFiles) {
    const expected = join(committedSchemas, file);
    const generated = join(generatedSchemas, file);
    if (
      !existsSync(expected) ||
      !existsSync(generated) ||
      readFileSync(expected, 'utf8') !== readFileSync(generated, 'utf8')
    )
      drift.push(`packages/api-contract/schemas/${file}`);
  }
  if (drift.length) {
    console.error(`Generated contract drift detected:\n${drift.join('\n')}`);
    process.exitCode = 1;
  } else console.log('Generated contract artifacts are up to date.');
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

function listJsonFiles(directory, prefix = '') {
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .flatMap((file) => {
      const relative = join(prefix, file);
      const fullPath = join(directory, file);
      return statSync(fullPath).isDirectory() ? listJsonFiles(fullPath, relative) : [relative];
    })
    .filter((file) => file.endsWith('.json'));
}
