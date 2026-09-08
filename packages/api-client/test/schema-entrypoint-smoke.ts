import manifest, {
  type OperationSchemaManifest,
  type OperationSchemaRecord,
} from '@reup-dubbing-studio/api-contract/schemas' with { type: 'json' };

const typedManifest: OperationSchemaManifest = manifest;

export function resolveOperation(
  contract: OperationSchemaRecord['contract'],
  operationId: string,
): OperationSchemaRecord | undefined {
  return typedManifest.operations.find(
    (operation) => operation.contract === contract && operation.operationId === operationId,
  );
}
