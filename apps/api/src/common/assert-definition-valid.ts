import { BadRequestException } from '@nestjs/common';
import {
  WorkflowValidationError,
  assertValidWorkflowDefinition,
  type WorkflowDefinition,
} from '@conduit/shared';

// Re-throw semantic validation as 400 so the UI sees the issue list, not a 500.
export function assertDefinitionValid(definition: WorkflowDefinition): void {
  try {
    assertValidWorkflowDefinition(definition);
  } catch (err) {
    if (err instanceof WorkflowValidationError) {
      throw new BadRequestException({
        message: err.message,
        issues: err.issues,
      });
    }
    throw err;
  }
}
