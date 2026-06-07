/**
 * Load environment variables from .env BEFORE any other module is imported.
 * This file must be the very first import in the application entry point.
 */
import * as dotenv from 'dotenv';
dotenv.config();
