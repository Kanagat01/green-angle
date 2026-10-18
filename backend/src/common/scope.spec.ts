import { ForbiddenException } from '@nestjs/common';
import { Role } from '../generated/prisma/client.js';
import { AuthUser } from '../auth/auth-user.js';
import { assertClientAccess, clientScope } from './scope.js';

const user = (role: Role, clientId: string | null): AuthUser => ({
  id: 'u1',
  role,
  clientId,
});

describe('clientScope', () => {
  it('returns an empty filter for ADMIN', () => {
    expect(clientScope(user(Role.ADMIN, null))).toEqual({});
  });

  it.each([Role.BROKER, Role.INDIVIDUAL])(
    'restricts %s to its clientId',
    (role) => {
      expect(clientScope(user(role, 'c1'))).toEqual({ clientId: 'c1' });
    },
  );

  it('throws for a non-admin without a client', () => {
    expect(() => clientScope(user(Role.BROKER, null))).toThrow(
      ForbiddenException,
    );
  });
});

describe('assertClientAccess', () => {
  it('lets ADMIN access any client', () => {
    expect(() =>
      assertClientAccess(user(Role.ADMIN, null), 'c1'),
    ).not.toThrow();
  });

  it('lets a client access itself', () => {
    expect(() =>
      assertClientAccess(user(Role.BROKER, 'c1'), 'c1'),
    ).not.toThrow();
  });

  it('forbids access to another client', () => {
    expect(() => assertClientAccess(user(Role.INDIVIDUAL, 'c1'), 'c2')).toThrow(
      ForbiddenException,
    );
  });

  it('forbids a non-admin without a client', () => {
    expect(() => assertClientAccess(user(Role.BROKER, null), 'c1')).toThrow(
      ForbiddenException,
    );
  });
});
