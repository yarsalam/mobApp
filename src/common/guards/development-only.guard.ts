import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

/**
 * Fail-closed gate for development-only diagnostics and test utilities.
 * Never enable these routes in production or in an unknown runtime mode.
 */
@Injectable()
export class DevelopmentOnlyGuard implements CanActivate {
  canActivate(_context: ExecutionContext): boolean {
    const environment = process.env.NODE_ENV ?? '';
    const explicitlyEnabled = process.env.ENABLE_DEBUG_ENDPOINTS === 'true';

    if (
      !['development', 'test'].includes(environment) ||
      !explicitlyEnabled
    ) {
      throw new NotFoundException();
    }

    return true;
  }
}
