import { BadRequestException, Injectable, type PipeTransform } from '@nestjs/common';
import type { ZodType, ZodTypeDef } from 'zod';

/**
 * Zod validation pipe. Schemas live in `@conduit/shared` so request shapes
 * match UI form shapes without duplication.
 */
@Injectable()
export class ZodBodyPipe<TSchema extends ZodType<unknown, ZodTypeDef, unknown>>
  implements PipeTransform<unknown, unknown>
{
  constructor(private readonly schema: TSchema) {}

  transform(value: unknown): unknown {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        message: 'Validation failed',
        issues: result.error.issues,
      });
    }
    return result.data;
  }
}
