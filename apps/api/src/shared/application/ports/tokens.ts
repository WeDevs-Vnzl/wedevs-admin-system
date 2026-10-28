/** DI tokens for the shared ports; bound to adapters only in the owning Nest module. */
export const CLOCK = Symbol('CLOCK');
export const ID_GENERATOR = Symbol('ID_GENERATOR');
export const UNIT_OF_WORK = Symbol('UNIT_OF_WORK');
export const ACTIVITY_LOG = Symbol('ACTIVITY_LOG');
export const SEQUENCE = Symbol('SEQUENCE');
export const AUTHORIZATION = Symbol('AUTHORIZATION');
export const AUTHENTICATOR = Symbol('AUTHENTICATOR');
export const SEARCH_INDEX = Symbol('SEARCH_INDEX');
export const CLIENT_METRICS_WRITER = Symbol('CLIENT_METRICS_WRITER');
export const REQUEST_CONTEXT = Symbol('REQUEST_CONTEXT');
