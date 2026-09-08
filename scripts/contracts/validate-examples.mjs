import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const sources = process.argv.slice(2).map((source) => resolve(root, source));
const documents = new Map();
const failures = [];

for (const source of sources) {
  const document = load(source);
  for (const [name, schema] of Object.entries(document.components?.schemas ?? {}).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const resolved = resolveSchema(schema, source, new Set());
    if (!hasExample(resolved)) {
      failures.push(`${source}: components.schemas.${name} must define example`);
    }
  }

  for (const [path, pathItem] of Object.entries(document.paths ?? {}).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!isOperation(method)) continue;
      const requestSchema = operation.requestBody?.content?.['application/json']?.schema;
      if (requestSchema && !hasExample(resolveSchema(requestSchema, source, new Set()))) {
        failures.push(
          `${source}: ${method.toUpperCase()} ${path} request schema must define example`,
        );
      }
      for (const [status, response] of Object.entries(operation.responses ?? {})) {
        const responseSchema = response.content?.['application/json']?.schema;
        if (responseSchema && !hasExample(resolveSchema(responseSchema, source, new Set()))) {
          failures.push(
            `${source}: ${method.toUpperCase()} ${path} response ${status} schema must define example`,
          );
        }
      }
    }
  }
}

if (failures.length > 0) {
  console.error('OpenAPI schema example validation failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Schema example validation passed for ${sources.length} OpenAPI entrypoints.`);

function load(source) {
  if (!documents.has(source)) documents.set(source, YAML.parse(readFileSync(source, 'utf8')));
  return documents.get(source);
}

function resolveSchema(value, source, seen) {
  if (Array.isArray(value)) return value.map((item) => resolveSchema(item, source, seen));
  if (!value || typeof value !== 'object') return value;
  if (typeof value.$ref === 'string') {
    const [targetFile, fragment] = value.$ref.split('#');
    const target = resolve(targetFile ? join(dirname(source), targetFile) : source);
    const key = `${target}#${fragment ?? ''}`;
    if (seen.has(key)) return value;
    const nextSeen = new Set(seen).add(key);
    let resolved = load(target);
    for (const part of (fragment ?? '').split('/').filter(Boolean)) {
      resolved = resolved?.[part.replaceAll('~1', '/').replaceAll('~0', '~')];
    }
    const expanded = resolveSchema(resolved ?? {}, target, nextSeen);
    const siblings = Object.fromEntries(Object.entries(value).filter(([key]) => key !== '$ref'));
    return { ...expanded, ...resolveSchema(siblings, source, nextSeen) };
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, resolveSchema(child, source, seen)]),
  );
}

function hasExample(schema) {
  return Boolean(
    schema && typeof schema === 'object' && Object.prototype.hasOwnProperty.call(schema, 'example'),
  );
}

function isOperation(method) {
  return ['get', 'put', 'post', 'patch', 'delete', 'head', 'options', 'trace'].includes(method);
}
