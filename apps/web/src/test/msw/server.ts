import { setupServer } from 'msw/node';

import { handlers } from './handlers';

export { READY_REQUEST_ID } from './handlers';

export const server = setupServer(...handlers);
