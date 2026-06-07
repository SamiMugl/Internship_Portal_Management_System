/**
 * Unit tests for AppError — the typed application error class used across
 * auth and other service modules.
 */

import { AppError } from '../services/authService';

describe('AppError', () => {
  it('creates an error with correct properties', () => {
    const err = new AppError(409, 'DUPLICATE_EMAIL', 'Email already exists.', { field: 'email' });

    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(409);
    expect(err.code).toBe('DUPLICATE_EMAIL');
    expect(err.message).toBe('Email already exists.');
    expect(err.details).toEqual({ field: 'email' });
    expect(err.name).toBe('AppError');
  });

  it('creates an error without details', () => {
    const err = new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');

    expect(err.details).toBeUndefined();
  });

  it('inherits from Error so it can be caught generically', () => {
    const err = new AppError(500, 'INTERNAL', 'Something went wrong');

    try {
      throw err;
    } catch (caught) {
      expect(caught instanceof Error).toBe(true);
      expect((caught as AppError).code).toBe('INTERNAL');
    }
  });
});
