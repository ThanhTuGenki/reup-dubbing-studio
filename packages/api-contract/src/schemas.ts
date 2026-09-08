/**
 * GENERATED FILE — DO NOT EDIT. Source: packages/api-contract/schemas/index.json
 */
export interface OperationSchemaRecord {
  contract: 'web' | 'worker';
  operationId: string;
  file: `${'web' | 'worker'}/${string}.json`;
}

export interface OperationSchemaManifest {
  $schema: string;
  $comment: string;
  title: string;
  operations: OperationSchemaRecord[];
}

declare const manifest: OperationSchemaManifest;
export default manifest;
