/**
 * ReportService
 *
 * Provides admin reporting business logic:
 *   - getSummaryReport       — counts of registered students, employers, published listings,
 *                              and applications within an optional date range
 *   - getApplicationBreakdown — ApplicationStatus counts grouped per listing and per employer
 *   - getPlacementRate       — accepted applications vs total applications ratio
 *   - getTrendData           — daily time-series of registrations, listings, and applications
 *
 * All database access uses parameterised queries via BaseRepository to prevent SQL injection.
 *
 * Requirements: 10.1, 10.2, 10.3, 10.5
 */

import { BaseRepository } from '../database/baseRepository';
import { ApplicationStatus } from '../types';

// ---------------------------------------------------------------------------
// DTOs and response shapes
// ---------------------------------------------------------------------------

/**
 * Optional filters applicable to all report endpoints.
 *
 * - dateFrom / dateTo  — restrict counts to records created within the range
 * - institution        — restrict student counts to a specific academic institution
 * - industry           — restrict employer / listing counts to a specific industry sector
 *
 * Requirements: 10.1, 10.6
 */
export interface ReportFilterDTO {
  dateFrom?: Date;
  dateTo?: Date;
  institution?: string;
  industry?: string;
}

/**
 * Summary report: aggregate counts for the portal.
 *
 * Requirement 10.1
 */
export interface SummaryReport {
  /** Number of registered users with role = 'student', filtered by date range / institution */
  students: number;
  /** Number of registered users with role = 'employer', filtered by date range / industry */
  employers: number;
  /** Number of listings with status = 'published', filtered by date range / industry */
  publishedListings: number;
  /** Number of applications, filtered by date range */
  applications: number;
}

/**
 * Application status breakdown for a single internship listing.
 *
 * Requirement 10.2
 */
export interface ListingStatusBreakdown {
  listingId: string;
  listingTitle: string;
  employerId: string;
  companyName: string;
  statusCounts: Partial<Record<ApplicationStatus, number>>;
}

/**
 * Application status breakdown for a single employer (aggregated across all their listings).
 *
 * Requirement 10.2
 */
export interface EmployerStatusBreakdown {
  employerId: string;
  companyName: string;
  statusCounts: Partial<Record<ApplicationStatus, number>>;
}

/**
 * Full application breakdown response.
 *
 * Requirement 10.2
 */
export interface ApplicationBreakdown {
  byListing: ListingStatusBreakdown[];
  byEmployer: EmployerStatusBreakdown[];
}

/**
 * Placement rate response: ratio of accepted applications to total applications.
 *
 * Requirement 10.3
 */
export interface PlacementRate {
  /** Number of applications with status = 'Accepted' in the date range */
  acceptedCount: number;
  /** Total number of applications in the date range */
  totalApplications: number;
  /**
   * acceptedCount / totalApplications, or 0.0 when totalApplications is zero
   */
  placementRate: number;
}

/**
 * A single daily data point in the trend report.
 *
 * Requirement 10.5
 */
export interface TrendDataPoint {
  /** Calendar date in YYYY-MM-DD format */
  date: string;
  /** Number of new user registrations on this date */
  registrations: number;
  /** Number of new internship listings created on this date */
  newListings: number;
  /** Number of new applications submitted on this date */
  newApplications: number;
}

/**
 * Trend data response: one data point per day for the past N days.
 *
 * Requirement 10.5
 */
export interface TrendData {
  /** Number of days covered by this report */
  days: number;
  /** Ordered list of daily data points (ascending by date) */
  dataPoints: TrendDataPoint[];
}

// ---------------------------------------------------------------------------
// ReportService
// ---------------------------------------------------------------------------

export class ReportService extends BaseRepository {
  // -------------------------------------------------------------------------
  // getSummaryReport
  // -------------------------------------------------------------------------

  /**
   * Return aggregate counts for the portal, optionally filtered by date range,
   * institution (students), and industry (employers / listings).
   *
   * - students        : users.role = 'student', filtered by users.created_at and
   *                     student_profiles.institution when provided
   * - employers       : users.role = 'employer', filtered by users.created_at and
   *                     employer_profiles.industry when provided
   * - publishedListings: listings.status = 'published', filtered by listings.created_at
   *                     and employer_profiles.industry when provided
   * - applications    : all applications, filtered by applications.submitted_at
   *
   * Requirements: 10.1, 10.6
   */
  async getSummaryReport(filters: ReportFilterDTO): Promise<SummaryReport> {
    const { dateFrom, dateTo, institution, industry } = filters;

    // -----------------------------------------------------------------------
    // Students count
    // -----------------------------------------------------------------------
    const studentConditions: string[] = [`u.role = 'student'`];
    const studentParams: unknown[] = [];

    if (dateFrom) {
      studentParams.push(dateFrom);
      studentConditions.push(`u.created_at >= $${studentParams.length}`);
    }
    if (dateTo) {
      studentParams.push(dateTo);
      studentConditions.push(`u.created_at <= $${studentParams.length}`);
    }
    if (institution) {
      studentParams.push(institution);
      studentConditions.push(
        `EXISTS (
           SELECT 1 FROM student_profiles sp
           WHERE  sp.user_id = u.id
           AND    sp.institution ILIKE $${studentParams.length}
         )`,
      );
    }

    const studentRow = await this.queryOne<{ count: string }>(
      `SELECT COUNT(*) AS count FROM users u WHERE ${studentConditions.join(' AND ')}`,
      studentParams,
    );

    // -----------------------------------------------------------------------
    // Employers count
    // -----------------------------------------------------------------------
    const employerConditions: string[] = [`u.role = 'employer'`];
    const employerParams: unknown[] = [];

    if (dateFrom) {
      employerParams.push(dateFrom);
      employerConditions.push(`u.created_at >= $${employerParams.length}`);
    }
    if (dateTo) {
      employerParams.push(dateTo);
      employerConditions.push(`u.created_at <= $${employerParams.length}`);
    }
    if (industry) {
      employerParams.push(industry);
      employerConditions.push(
        `EXISTS (
           SELECT 1 FROM employer_profiles ep
           WHERE  ep.user_id = u.id
           AND    ep.industry ILIKE $${employerParams.length}
         )`,
      );
    }

    const employerRow = await this.queryOne<{ count: string }>(
      `SELECT COUNT(*) AS count FROM users u WHERE ${employerConditions.join(' AND ')}`,
      employerParams,
    );

    // -----------------------------------------------------------------------
    // Published listings count
    // -----------------------------------------------------------------------
    const listingConditions: string[] = [`l.status = 'published'`];
    const listingParams: unknown[] = [];

    if (dateFrom) {
      listingParams.push(dateFrom);
      listingConditions.push(`l.created_at >= $${listingParams.length}`);
    }
    if (dateTo) {
      listingParams.push(dateTo);
      listingConditions.push(`l.created_at <= $${listingParams.length}`);
    }
    if (industry) {
      listingParams.push(industry);
      listingConditions.push(
        `EXISTS (
           SELECT 1 FROM employer_profiles ep
           WHERE  ep.id = l.employer_id
           AND    ep.industry ILIKE $${listingParams.length}
         )`,
      );
    }

    const listingRow = await this.queryOne<{ count: string }>(
      `SELECT COUNT(*) AS count FROM listings l WHERE ${listingConditions.join(' AND ')}`,
      listingParams,
    );

    // -----------------------------------------------------------------------
    // Applications count
    // -----------------------------------------------------------------------
    const appConditions: string[] = [];
    const appParams: unknown[] = [];

    if (dateFrom) {
      appParams.push(dateFrom);
      appConditions.push(`a.submitted_at >= $${appParams.length}`);
    }
    if (dateTo) {
      appParams.push(dateTo);
      appConditions.push(`a.submitted_at <= $${appParams.length}`);
    }

    const appWhereClause =
      appConditions.length > 0 ? `WHERE ${appConditions.join(' AND ')}` : '';

    const appRow = await this.queryOne<{ count: string }>(
      `SELECT COUNT(*) AS count FROM applications a ${appWhereClause}`,
      appParams,
    );

    return {
      students:         parseInt(studentRow?.count  ?? '0', 10),
      employers:        parseInt(employerRow?.count ?? '0', 10),
      publishedListings: parseInt(listingRow?.count ?? '0', 10),
      applications:     parseInt(appRow?.count      ?? '0', 10),
    };
  }

  // -------------------------------------------------------------------------
  // getApplicationBreakdown
  // -------------------------------------------------------------------------

  /**
   * Return ApplicationStatus counts grouped per listing and per employer.
   *
   * Per listing: each listing gets a map of { [ApplicationStatus]: count }.
   * Per employer: counts are summed across all listings owned by that employer.
   *
   * Filters:
   *   - dateFrom / dateTo — filter applications by submitted_at
   *   - institution       — filter applications whose student belongs to this institution
   *   - industry          — filter applications whose listing's employer belongs to this industry
   *
   * Requirements: 10.2, 10.6
   */
  async getApplicationBreakdown(filters: ReportFilterDTO): Promise<ApplicationBreakdown> {
    const { dateFrom, dateTo, institution, industry } = filters;

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (dateFrom) {
      params.push(dateFrom);
      conditions.push(`a.submitted_at >= $${params.length}`);
    }
    if (dateTo) {
      params.push(dateTo);
      conditions.push(`a.submitted_at <= $${params.length}`);
    }
    if (institution) {
      params.push(institution);
      conditions.push(
        `EXISTS (
           SELECT 1 FROM student_profiles sp
           WHERE  sp.user_id = a.student_id
           AND    sp.institution ILIKE $${params.length}
         )`,
      );
    }
    if (industry) {
      params.push(industry);
      conditions.push(
        `EXISTS (
           SELECT 1 FROM employer_profiles ep
           WHERE  ep.id = l.employer_id
           AND    ep.industry ILIKE $${params.length}
         )`,
      );
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Fetch per-listing status counts joined with listing title and employer info.
    const rows = await this.query<{
      listing_id: string;
      listing_title: string;
      employer_id: string;
      company_name: string;
      status: ApplicationStatus;
      cnt: string;
    }>(
      `SELECT
         a.listing_id,
         l.title            AS listing_title,
         l.employer_id,
         ep.company_name,
         a.status,
         COUNT(*)::text     AS cnt
       FROM   applications a
       JOIN   listings          l  ON l.id  = a.listing_id
       JOIN   employer_profiles ep ON ep.id = l.employer_id
       ${whereClause}
       GROUP  BY a.listing_id, l.title, l.employer_id, ep.company_name, a.status
       ORDER  BY ep.company_name ASC, l.title ASC, a.status ASC`,
      params,
    );

    // -----------------------------------------------------------------------
    // Build byListing map
    // -----------------------------------------------------------------------
    const listingMap = new Map<
      string,
      { listingTitle: string; employerId: string; companyName: string; statusCounts: Partial<Record<ApplicationStatus, number>> }
    >();

    for (const row of rows) {
      if (!listingMap.has(row.listing_id)) {
        listingMap.set(row.listing_id, {
          listingTitle: row.listing_title,
          employerId:   row.employer_id,
          companyName:  row.company_name,
          statusCounts: {},
        });
      }
      const entry = listingMap.get(row.listing_id)!;
      entry.statusCounts[row.status] = parseInt(row.cnt, 10);
    }

    const byListing: ListingStatusBreakdown[] = Array.from(listingMap.entries()).map(
      ([listingId, v]) => ({
        listingId,
        listingTitle: v.listingTitle,
        employerId:   v.employerId,
        companyName:  v.companyName,
        statusCounts: v.statusCounts,
      }),
    );

    // -----------------------------------------------------------------------
    // Build byEmployer map (aggregate across all listings)
    // -----------------------------------------------------------------------
    const employerMap = new Map<
      string,
      { companyName: string; statusCounts: Partial<Record<ApplicationStatus, number>> }
    >();

    for (const row of rows) {
      if (!employerMap.has(row.employer_id)) {
        employerMap.set(row.employer_id, {
          companyName:  row.company_name,
          statusCounts: {},
        });
      }
      const entry = employerMap.get(row.employer_id)!;
      const current = entry.statusCounts[row.status] ?? 0;
      entry.statusCounts[row.status] = current + parseInt(row.cnt, 10);
    }

    const byEmployer: EmployerStatusBreakdown[] = Array.from(employerMap.entries()).map(
      ([employerId, v]) => ({
        employerId,
        companyName:  v.companyName,
        statusCounts: v.statusCounts,
      }),
    );

    return { byListing, byEmployer };
  }

  // -------------------------------------------------------------------------
  // getPlacementRate
  // -------------------------------------------------------------------------

  /**
   * Return the ratio of accepted applications to total applications within the
   * specified date range.
   *
   * - acceptedCount      : applications with status = 'Accepted' filtered by submitted_at
   * - totalApplications  : all applications filtered by submitted_at
   * - placementRate      : acceptedCount / totalApplications, or 0.0 when total is zero
   *
   * Requirement 10.3
   */
  async getPlacementRate(filters: ReportFilterDTO): Promise<PlacementRate> {
    const { dateFrom, dateTo } = filters;

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (dateFrom) {
      params.push(dateFrom);
      conditions.push(`a.submitted_at >= $${params.length}`);
    }
    if (dateTo) {
      params.push(dateTo);
      conditions.push(`a.submitted_at <= $${params.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Count accepted and total in a single query using conditional aggregation.
    const row = await this.queryOne<{ accepted: string; total: string }>(
      `SELECT
         COUNT(*) FILTER (WHERE a.status = 'Accepted') AS accepted,
         COUNT(*)                                       AS total
       FROM applications a
       ${whereClause}`,
      params,
    );

    const acceptedCount     = parseInt(row?.accepted ?? '0', 10);
    const totalApplications = parseInt(row?.total    ?? '0', 10);
    const placementRate     = totalApplications === 0
      ? 0.0
      : acceptedCount / totalApplications;

    return { acceptedCount, totalApplications, placementRate };
  }

  // -------------------------------------------------------------------------
  // getTrendData
  // -------------------------------------------------------------------------

  /**
   * Return one data point per day for the past `days` days, covering:
   *   - registrations   : new users created on that calendar day
   *   - newListings     : new listings created on that calendar day
   *   - newApplications : new applications submitted on that calendar day
   *
   * Uses a PostgreSQL `generate_series` to guarantee a row for every day,
   * even when a particular table has zero activity on that day.
   *
   * Requirement 10.5
   */
  async getTrendData(days: number): Promise<TrendData> {
    // We pass `days` as a parameter to keep the query safe.
    const rows = await this.query<{
      day: string;
      registrations: string;
      new_listings: string;
      new_applications: string;
    }>(
      `SELECT
         TO_CHAR(d.day::date, 'YYYY-MM-DD') AS day,
         COALESCE(u.cnt,  0)::text           AS registrations,
         COALESCE(l.cnt,  0)::text           AS new_listings,
         COALESCE(a.cnt,  0)::text           AS new_applications
       FROM generate_series(
              (CURRENT_DATE - ($1::int - 1) * INTERVAL '1 day'),
              CURRENT_DATE,
              INTERVAL '1 day'
            ) AS d(day)
       LEFT JOIN (
         SELECT DATE(created_at) AS dy, COUNT(*) AS cnt
         FROM   users
         GROUP  BY dy
       ) u ON u.dy = d.day::date
       LEFT JOIN (
         SELECT DATE(created_at) AS dy, COUNT(*) AS cnt
         FROM   listings
         GROUP  BY dy
       ) l ON l.dy = d.day::date
       LEFT JOIN (
         SELECT DATE(submitted_at) AS dy, COUNT(*) AS cnt
         FROM   applications
         GROUP  BY dy
       ) a ON a.dy = d.day::date
       ORDER BY d.day ASC`,
      [days],
    );

    const dataPoints: TrendDataPoint[] = rows.map((r) => ({
      date:            r.day,
      registrations:   parseInt(r.registrations,   10),
      newListings:     parseInt(r.new_listings,     10),
      newApplications: parseInt(r.new_applications, 10),
    }));

    return { days, dataPoints };
  }

  // -------------------------------------------------------------------------
  // exportToCsv
  // -------------------------------------------------------------------------

  /**
   * Serialise a report dataset to CSV and return it as a UTF-8 Buffer.
   *
   * Report types and their columns:
   *   'summary'       : students, employers, publishedListings, applications
   *   'applications'  : listingId, listingTitle, employerId, companyName, <one col per ApplicationStatus>
   *   'placement-rate': acceptedCount, totalApplications, placementRate
   *   'trends'        : date, registrations, newListings, newApplications
   *
   * Values containing commas or double-quotes are wrapped in double-quotes;
   * inner double-quotes are escaped by doubling them ("").
   *
   * Requirements: 10.4, 10.6
   */
  async exportToCsv(reportType: ReportType, filters: ReportFilterDTO): Promise<Buffer> {
    const csvEscape = (value: unknown): string => {
      const str = String(value ?? '');
      if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const buildRow = (values: unknown[]): string =>
      values.map(csvEscape).join(',');

    let csvContent: string;

    switch (reportType) {
      case 'summary': {
        const data = await this.getSummaryReport(filters);
        const header = 'students,employers,publishedListings,applications';
        const row = buildRow([
          data.students,
          data.employers,
          data.publishedListings,
          data.applications,
        ]);
        csvContent = `${header}\n${row}\n`;
        break;
      }

      case 'applications': {
        const data = await this.getApplicationBreakdown(filters);
        // Use all ApplicationStatus values as columns
        const allStatuses = Object.values(ApplicationStatus);
        const header = buildRow([
          'listingId',
          'listingTitle',
          'employerId',
          'companyName',
          ...allStatuses,
        ]);
        const dataRows = data.byListing.map((entry) =>
          buildRow([
            entry.listingId,
            entry.listingTitle,
            entry.employerId,
            entry.companyName,
            ...allStatuses.map((s) => entry.statusCounts[s] ?? 0),
          ]),
        );
        csvContent = [header, ...dataRows].join('\n') + '\n';
        break;
      }

      case 'placement-rate': {
        const data = await this.getPlacementRate(filters);
        const header = 'acceptedCount,totalApplications,placementRate';
        const row = buildRow([
          data.acceptedCount,
          data.totalApplications,
          data.placementRate,
        ]);
        csvContent = `${header}\n${row}\n`;
        break;
      }

      case 'trends': {
        const data = await this.getTrendData(30);
        const header = 'date,registrations,newListings,newApplications';
        const dataRows = data.dataPoints.map((pt) =>
          buildRow([pt.date, pt.registrations, pt.newListings, pt.newApplications]),
        );
        csvContent = [header, ...dataRows].join('\n') + '\n';
        break;
      }

      default: {
        // TypeScript exhaustiveness guard — should never be reached
        const _exhaustive: never = reportType;
        throw new Error(`Unknown report type: ${_exhaustive}`);
      }
    }

    return Buffer.from(csvContent, 'utf-8');
  }
}

/**
 * The supported report type identifiers.
 *
 * Requirements: 10.4, 10.6
 */
export type ReportType = 'summary' | 'applications' | 'placement-rate' | 'trends';

// Singleton instance
export const reportService = new ReportService();
