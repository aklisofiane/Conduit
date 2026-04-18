// NestJS relies on emitDecoratorMetadata reading runtime type references —
// `consistent-type-imports` would collapse DI-injected services into type-only
// imports, breaking the DI container. Disable it here.
import base from '../../eslint.config.mjs';

export default [
  ...base,
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },
];
