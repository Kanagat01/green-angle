import { describeError } from './describe-error.js';

describe('describeError', () => {
  it('returns the message of a plain error', () => {
    expect(describeError(new Error('boom'))).toBe('boom');
  });

  it('adds the causes, because the real reason of a database error lives there', () => {
    const root = new Error("Can't reach database server at localhost:5432");
    const err = new Error('Invalid `prisma.$queryRaw()` invocation:\n\n\n', {
      cause: root,
    });
    expect(describeError(err)).toBe(
      "Invalid `prisma.$queryRaw()` invocation: ← Can't reach database server at localhost:5432",
    );
  });

  it('shows the code when the message carries nothing, as Prisma does for a refused connection', () => {
    const err = Object.assign(
      new Error('\nInvalid `prisma.$queryRaw()` invocation:\n\n\n'),
      {
        code: 'ECONNREFUSED',
      },
    );
    expect(describeError(err)).toBe(
      'Invalid `prisma.$queryRaw()` invocation: [ECONNREFUSED]',
    );
    expect(describeError(Object.assign(new Error(''), { code: 'P1001' }))).toBe(
      '[P1001]',
    );
  });

  it('does not repeat the same text and stops at a sane depth', () => {
    const a = new Error('same');
    const b = new Error('same', { cause: a });
    expect(describeError(b)).toBe('same');

    let deep: Error = new Error('level 0');
    for (let i = 1; i < 10; i++) {
      deep = new Error(`level ${i}`, { cause: deep });
    }
    expect(describeError(deep).split(' ← ')).toHaveLength(4);
  });

  it('copes with values that are not errors', () => {
    expect(describeError('text')).toBe('text');
    expect(describeError(undefined)).toBe('unknown error');
    expect(describeError('')).toBe('unknown error');
  });
});
