/**
 * GENERATED FILE — DO NOT EDIT. Source: packages/api-contract/schemas/index.json
 */
export interface OperationSchemaRecord {
  contract: 'web' | 'worker';
  operationId: string;
  file: `${'web' | 'worker'}/${string}.json`;
}

export interface ComponentSchemaRecord {
  document: 'shared';
  component: string;
  file: `shared/${string}.json`;
}

export interface ContractSchemaManifest {
  $schema: string;
  $comment: string;
  title: string;
  operations: OperationSchemaRecord[];
  components: ComponentSchemaRecord[];
}

export type OperationSchemaManifest = ContractSchemaManifest;

declare const manifest: ContractSchemaManifest;
export default manifest;
