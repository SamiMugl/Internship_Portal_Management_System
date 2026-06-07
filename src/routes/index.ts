/**
 * Root API router
 *
 * Mounts all sub-routers under their respective path prefixes.
 * This router is mounted at /api/v1 by app.ts.
 */

import { Router } from 'express';
import authRouter from './auth';
import studentProfileRouter from './studentProfile';
import employerProfileRouter from './employerProfile';
import { listingsRouter, employerListingsRouter } from './listings';
import { adminRouter } from './admin';
import {
  listingApplicationsRouter,
  studentApplicationsRouter,
  applicationsRouter,
} from './applications';
import notificationsRouter from './notifications';

const router = Router();

// Authentication endpoints (public)
router.use('/auth', authRouter);

// Student profile endpoints (require Student JWT)
router.use('/students', studentProfileRouter);

// Student application endpoints
//   GET  /students/me/applications
router.use('/students', studentApplicationsRouter);

// Employer profile endpoints (require Employer JWT)
// Merges: employer profile CRUD/logo + employer listings (GET /me/listings)
router.use('/employers', employerProfileRouter);
router.use('/employers', employerListingsRouter);

// Internship listing endpoints (employer management)
router.use('/listings', listingsRouter);

// Listing-scoped application endpoints (merged with /listings router):
//   POST /listings/:id/apply
//   GET  /listings/:id/applications
router.use('/listings', listingApplicationsRouter);

// Standalone application endpoints:
//   DELETE /applications/:id        (student withdrawal)
//   PUT    /applications/:id/status (employer status update)
router.use('/applications', applicationsRouter);

// Admin endpoints (require Admin JWT)
router.use('/admin', adminRouter);

// Notification endpoints (require any valid JWT)
router.use('/notifications', notificationsRouter);

export default router;
