/**
 * Express Request augmentation.
 *
 * Extends the Express `Request` interface with the `user` property that is
 * attached by the `authenticate` middleware after verifying the access-token
 * JWT.  Declaring this in a `.d.ts` file inside the `types` folder keeps the
 * augmentation co-located with the other shared type definitions.
 */

import { UserRole } from './index';

declare global {
  namespace Express {
    interface Request {
      /**
       * Decoded JWT payload attached by the `authenticate` middleware.
       * Present on every request that has successfully passed authentication.
       */
      user?: {
        /** User UUID (from the `sub` JWT claim) */
        userId: string;
        /** User role — one of student | employer | admin */
        role: UserRole;
        /** User email address */
        email: string;
      };
    }
  }
}
