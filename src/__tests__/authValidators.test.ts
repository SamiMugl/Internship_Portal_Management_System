/**
 * Unit tests for auth Zod validation schemas.
 *
 * These run entirely in-memory — no database connection required.
 */

import {
  registerStudentSchema,
  registerEmployerSchema,
} from '../validators/authValidators';

// ---------------------------------------------------------------------------
// registerStudentSchema
// ---------------------------------------------------------------------------

describe('registerStudentSchema', () => {
  const validStudent = {
    email: 'student@example.com',
    password: 'Password1',
    fullName: 'Jane Doe',
    institution: 'MIT',
    degree: 'B.Sc. Computer Science',
  };

  it('accepts a fully valid student payload', () => {
    const result = registerStudentSchema.safeParse(validStudent);
    expect(result.success).toBe(true);
  });

  it('normalises email to lowercase', () => {
    const result = registerStudentSchema.safeParse({
      ...validStudent,
      email: 'Student@EXAMPLE.COM',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe('student@example.com');
    }
  });

  it('accepts payload without optional fields (institution, degree)', () => {
    const { institution: _i, degree: _d, ...minimal } = validStudent;
    const result = registerStudentSchema.safeParse(minimal);
    expect(result.success).toBe(true);
  });

  it('rejects an invalid email address', () => {
    const result = registerStudentSchema.safeParse({ ...validStudent, email: 'not-an-email' });
    expect(result.success).toBe(false);
  });

  it('rejects a password shorter than 8 characters', () => {
    const result = registerStudentSchema.safeParse({ ...validStudent, password: 'abc123' });
    expect(result.success).toBe(false);
  });

  it('rejects a password longer than 128 characters', () => {
    const result = registerStudentSchema.safeParse({
      ...validStudent,
      password: 'a'.repeat(129),
    });
    expect(result.success).toBe(false);
  });

  it('rejects an empty fullName', () => {
    const result = registerStudentSchema.safeParse({ ...validStudent, fullName: '' });
    expect(result.success).toBe(false);
  });

  it('rejects when email is missing', () => {
    const { email: _e, ...noEmail } = validStudent;
    const result = registerStudentSchema.safeParse(noEmail);
    expect(result.success).toBe(false);
  });

  it('rejects when password is missing', () => {
    const { password: _p, ...noPassword } = validStudent;
    const result = registerStudentSchema.safeParse(noPassword);
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// registerEmployerSchema
// ---------------------------------------------------------------------------

describe('registerEmployerSchema', () => {
  const validEmployer = {
    email: 'employer@corp.com',
    password: 'Secure1234',
    companyName: 'Acme Corp',
    industry: 'Technology',
    contactPerson: 'John Smith',
  };

  it('accepts a fully valid employer payload', () => {
    const result = registerEmployerSchema.safeParse(validEmployer);
    expect(result.success).toBe(true);
  });

  it('accepts payload without optional industry field', () => {
    const { industry: _i, ...minimal } = validEmployer;
    const result = registerEmployerSchema.safeParse(minimal);
    expect(result.success).toBe(true);
  });

  it('normalises email to lowercase', () => {
    const result = registerEmployerSchema.safeParse({
      ...validEmployer,
      email: 'Employer@CORP.COM',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe('employer@corp.com');
    }
  });

  it('rejects an invalid email address', () => {
    const result = registerEmployerSchema.safeParse({ ...validEmployer, email: 'bad-email' });
    expect(result.success).toBe(false);
  });

  it('rejects an empty companyName', () => {
    const result = registerEmployerSchema.safeParse({ ...validEmployer, companyName: '' });
    expect(result.success).toBe(false);
  });

  it('rejects when contactPerson is missing', () => {
    const { contactPerson: _c, ...noContact } = validEmployer;
    const result = registerEmployerSchema.safeParse(noContact);
    expect(result.success).toBe(false);
  });
});
