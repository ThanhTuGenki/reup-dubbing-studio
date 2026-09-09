import assert from 'node:assert/strict';
import test from 'node:test';

import addFormats from 'ajv-formats';
import Ajv2020 from 'ajv/dist/2020.js';

import manifest from '@reup-dubbing-studio/api-contract/schemas' with { type: 'json' };

const problemDetailsRecord = manifest.components.find(
  (component) => component.document === 'shared' && component.component === 'ProblemDetails',
);

async function loadThroughPublicInterface(record) {
  const module = await import(`@reup-dubbing-studio/api-contract/schemas/${record.file}`, {
    with: { type: 'json' },
  });
  return module.default;
}

function compile(schema) {
  // strictSchema is relaxed because the artifact keeps the OpenAPI `example` annotation
  // from the contract; every other strict check stays on.
  const ajv = addFormats(new Ajv2020({ allErrors: true, strictSchema: false }));
  return ajv.compile(schema);
}

const validProblemDetails = {
  type: 'about:blank',
  title: 'Not Found',
  status: 404,
  detail: 'The requested resource was not found.',
  instance: '/v1/videos/jobs/0190f7d2-8f9c-7abc-8def-0123456789ab',
  code: 'NOT_FOUND',
  requestId: '0190f7d2-8f9c-7abc-8def-0123456789ab',
};

test('manifest publishes a record for the shared ProblemDetails component', () => {
  assert.deepEqual(problemDetailsRecord, {
    document: 'shared',
    component: 'ProblemDetails',
    file: 'shared/ProblemDetails.json',
  });
});

test('component artifact is loadable through the public package interface', async () => {
  const schema = await loadThroughPublicInterface(problemDetailsRecord);

  assert.match(schema.$comment, /GENERATED FILE — DO NOT EDIT/);
  assert.equal(schema.$id, 'urn:reup-dubbing-studio:shared:component:ProblemDetails');
});

test('Ajv compiles the artifact standalone with every $ref resolved', async () => {
  const schema = await loadThroughPublicInterface(problemDetailsRecord);

  assert.doesNotThrow(() => compile(schema));
});

test('artifact accepts a Problem Details body carrying code NOT_FOUND and requestId', async () => {
  const validate = compile(await loadThroughPublicInterface(problemDetailsRecord));

  assert.equal(validate(validProblemDetails), true, JSON.stringify(validate.errors));
});

test('artifact rejects a body missing a required field', async () => {
  const validate = compile(await loadThroughPublicInterface(problemDetailsRecord));
  const missingRequestId = { ...validProblemDetails };
  delete missingRequestId.requestId;

  assert.equal(validate(missingRequestId), false);
  assert.ok(
    validate.errors.some(
      (error) => error.keyword === 'required' && error.params.missingProperty === 'requestId',
    ),
  );
});

test('artifact rejects a code outside the generated ErrorCode enum', async () => {
  const validate = compile(await loadThroughPublicInterface(problemDetailsRecord));

  assert.equal(validate({ ...validProblemDetails, code: 'TEAPOT' }), false);
  assert.ok(validate.errors.some((error) => error.keyword === 'enum'));
});
