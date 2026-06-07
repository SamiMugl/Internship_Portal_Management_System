# Requirements Document

## Introduction

The Internship Portal Management System is a web-based platform that connects students seeking internship opportunities with companies offering them, supervised by an administrative authority. The system facilitates the complete internship lifecycle: student registration and profile management, company onboarding and internship listing, application submission and tracking, interview scheduling, offer management, and reporting. It serves three primary user roles — Students, Employers, and Administrators — each with distinct capabilities and responsibilities.

## Glossary

- **Student**: A registered user who is enrolled in an academic institution and is seeking internship opportunities through the portal.
- **Employer**: A registered company representative who posts internship listings and manages applications from students.
- **Administrator**: A privileged portal user responsible for approving accounts, moderating listings, overseeing operations, and generating reports.
- **Internship_Listing**: A structured posting created by an Employer that describes an available internship position, including role, duration, location, stipend, and eligibility criteria.
- **Application**: A formal submission made by a Student to express interest in an Internship_Listing.
- **Application_Status**: The current state of an Application, which may be one of: Submitted, Under_Review, Shortlisted, Interview_Scheduled, Offered, Accepted, Rejected, or Withdrawn.
- **Profile**: A collection of personal, academic, and professional information associated with a Student or Employer account.
- **Resume**: A document uploaded by a Student that summarises their academic and professional background.
- **Portal**: The Internship Portal Management System as a whole.
- **Notification**: An in-app or email message sent to a user informing them of a relevant event.
- **Shortlist**: The act of an Employer selecting specific Applications for further review or interview.
- **Offer**: A formal internship offer extended by an Employer to a Shortlisted Student.
- **Report**: A generated summary of portal activity, application statistics, or placement outcomes produced by the Administrator.

---

## Requirements

### Requirement 1: Student Registration and Authentication

**User Story:** As a student, I want to register and securely log in to the portal, so that I can access internship opportunities and manage my applications.

#### Acceptance Criteria

1. WHEN a student submits a registration form with a valid institutional email address, full name, password, and academic details, THE Portal SHALL create a new Student account and send a verification email.
2. WHEN a student clicks the email verification link within 24 hours of receiving it, THE Portal SHALL activate the Student account and allow login.
3. IF a student attempts to register with an email address that is already associated with an existing account, THEN THE Portal SHALL reject the registration and display a descriptive error message.
4. WHEN a registered student submits valid credentials (email and password), THE Portal SHALL authenticate the student and grant access to the student dashboard.
5. IF a student submits incorrect credentials three consecutive times, THEN THE Portal SHALL temporarily lock the account for 15 minutes and notify the student via email.
6. WHEN a student requests a password reset and provides a registered email, THE Portal SHALL send a password-reset link that expires after 1 hour.
7. WHEN an authenticated student session remains idle for more than 30 minutes, THE Portal SHALL terminate the session and require re-authentication.

---

### Requirement 2: Student Profile Management

**User Story:** As a student, I want to build and maintain a comprehensive profile, so that employers can evaluate my qualifications and I can apply efficiently.

#### Acceptance Criteria

1. THE Student SHALL be able to update their profile including personal details, academic information (institution, degree, GPA, graduation year), skills, work experience, and a profile photo.
2. WHEN a student uploads a Resume, THE Portal SHALL accept files in PDF or DOCX format with a maximum size of 5 MB and store them securely.
3. IF a student uploads a file that exceeds 5 MB or is in an unsupported format, THEN THE Portal SHALL reject the upload and display a descriptive error message.
4. THE Portal SHALL display a profile completion percentage to the Student, calculated based on the number of mandatory and optional fields populated.
5. WHEN a student saves profile changes, THE Portal SHALL persist the updated data and confirm the save with a success notification.
6. WHILE a student's profile completion is below 60%, THE Portal SHALL display a prompt encouraging the student to complete their profile before applying to listings.

---

### Requirement 3: Employer Registration, Authentication, and Company Profile

**User Story:** As an employer, I want to register my company and manage our profile, so that students can discover us and apply to our internship listings.

#### Acceptance Criteria

1. WHEN an employer submits a registration form with a valid company email, company name, industry, contact person name, and password, THE Portal SHALL create a new Employer account pending Administrator approval.
2. WHEN an Administrator approves an Employer account, THE Portal SHALL notify the employer via email and activate their account.
3. IF an Administrator rejects an Employer account, THEN THE Portal SHALL notify the employer via email with the reason for rejection.
4. WHEN an approved employer logs in with valid credentials, THE Portal SHALL authenticate the employer and grant access to the employer dashboard.
5. THE Employer SHALL be able to update their company profile including company description, logo, website URL, industry, size, and contact information.
6. WHEN an employer saves company profile changes, THE Portal SHALL persist the updated data and confirm the save with a success notification.
7. IF an employer submits a logo image that exceeds 2 MB or is not in PNG or JPG format, THEN THE Portal SHALL reject the upload and display a descriptive error message.

---

### Requirement 4: Internship Listing Management

**User Story:** As an employer, I want to create and manage internship listings, so that qualified students can discover and apply to available positions.

#### Acceptance Criteria

1. WHEN an approved employer submits a new Internship_Listing with a role title, description, required skills, duration, location, application deadline, and number of openings, THE Portal SHALL create the listing and submit it for Administrator review.
2. WHEN an Administrator approves an Internship_Listing, THE Portal SHALL publish it and make it visible to all authenticated students.
3. IF an Administrator rejects an Internship_Listing, THEN THE Portal SHALL notify the employer with the reason for rejection and allow resubmission.
4. WHEN the application deadline of an Internship_Listing passes, THE Portal SHALL automatically close the listing and prevent new Applications from being submitted.
5. WHEN an employer edits a published Internship_Listing, THE Portal SHALL save the changes and mark the listing as pending re-review by the Administrator.
6. WHEN an employer deactivates an Internship_Listing, THE Portal SHALL remove it from student-facing search results while retaining existing Applications.
7. THE Employer SHALL be able to view all their Internship_Listings with their current status (Draft, Pending, Published, Closed, Rejected).

---

### Requirement 5: Internship Search and Discovery

**User Story:** As a student, I want to search and filter internship listings, so that I can find opportunities that match my skills and preferences.

#### Acceptance Criteria

1. WHEN an authenticated student accesses the internship search page, THE Portal SHALL display all currently published Internship_Listings in order of most recently posted.
2. WHEN a student applies one or more filters (industry, location, duration, stipend range, required skills, or application deadline), THE Portal SHALL return only the Internship_Listings that match all selected filter criteria.
3. WHEN a student enters a keyword in the search bar, THE Portal SHALL return Internship_Listings whose title, description, or required skills contain the keyword.
4. WHEN a student views an Internship_Listing detail page, THE Portal SHALL display the full listing details including company profile summary, role description, eligibility, compensation, duration, location, and application deadline.
5. THE Portal SHALL display the number of remaining openings on each Internship_Listing visible to students.
6. WHEN the number of accepted applications for a listing reaches the specified number of openings, THE Portal SHALL close the listing and prevent further applications.

---

### Requirement 6: Application Submission and Management

**User Story:** As a student, I want to submit and track my applications, so that I can monitor my progress and respond promptly to employer actions.

#### Acceptance Criteria

1. WHEN a student clicks "Apply" on a published Internship_Listing and confirms the submission, THE Portal SHALL create an Application with status Submitted and associate it with the student's current Resume.
2. IF a student attempts to apply to the same Internship_Listing more than once, THEN THE Portal SHALL prevent the duplicate Application and display an informational message.
3. IF a student attempts to apply to an Internship_Listing after its application deadline, THEN THE Portal SHALL reject the submission and display a descriptive error message.
4. WHEN an Application is submitted, THE Portal SHALL send a confirmation Notification to the student.
5. THE Student SHALL be able to view all their Applications along with the current Application_Status for each.
6. WHEN a student withdraws an Application with status Submitted or Under_Review, THE Portal SHALL update the Application_Status to Withdrawn and notify the employer.
7. WHILE an Application status is Shortlisted, Interview_Scheduled, Offered, Accepted, or Rejected, THE Portal SHALL prevent the student from withdrawing that Application.

---

### Requirement 7: Employer Application Review and Workflow

**User Story:** As an employer, I want to review and manage applications for my listings, so that I can efficiently identify and select the best candidates.

#### Acceptance Criteria

1. WHEN an employer views the Applications for an Internship_Listing, THE Portal SHALL display all Applications with Application_Status, student name, academic details, and submission date.
2. WHEN an employer updates an Application_Status to Under_Review, Shortlisted, or Rejected, THE Portal SHALL persist the new status and notify the student via Notification.
3. WHEN an employer shortlists a student, THE Portal SHALL allow the employer to schedule an interview by specifying a date, time, mode (online or in-person), and location or meeting link.
4. WHEN an interview is scheduled, THE Portal SHALL send a Notification to the student containing the interview details.
5. WHEN an employer updates an Application_Status to Offered, THE Portal SHALL send an Offer Notification to the student with internship start date, duration, and stipend details.
6. WHEN a student accepts an Offer, THE Portal SHALL update the Application_Status to Accepted and notify the employer.
7. WHEN a student rejects an Offer, THE Portal SHALL update the Application_Status to Rejected and notify the employer.
8. THE Employer SHALL be able to filter and sort Applications by Application_Status, submission date, GPA, and student institution.

---

### Requirement 8: Administrator Account and Listing Oversight

**User Story:** As an administrator, I want to review and moderate employer accounts and internship listings, so that I can maintain the quality and integrity of the portal.

#### Acceptance Criteria

1. WHEN an Administrator logs in with valid credentials, THE Portal SHALL grant access to the admin dashboard displaying counts of pending Employer accounts, pending Internship_Listings, active students, and total applications.
2. THE Administrator SHALL be able to view a list of all Employer accounts with their approval status and approve or reject individual accounts.
3. WHEN an Administrator approves or rejects an Employer account, THE Portal SHALL update the account status and send the appropriate Notification to the employer.
4. THE Administrator SHALL be able to view, approve, and reject submitted Internship_Listings, including a reason for rejection.
5. THE Administrator SHALL be able to deactivate any Student or Employer account in cases of policy violations, and THE Portal SHALL prevent deactivated accounts from logging in.
6. WHEN an Administrator deactivates an account, THE Portal SHALL notify the affected user via email.
7. THE Administrator SHALL be able to view a full audit log of all approval, rejection, and deactivation actions taken, including timestamp and administrator identity.

---

### Requirement 9: Notifications

**User Story:** As a user, I want to receive timely notifications about relevant events, so that I can take prompt action on my applications, offers, and account status.

#### Acceptance Criteria

1. WHEN a triggering event occurs (application status change, interview scheduled, offer received, account approved or rejected), THE Portal SHALL create an in-app Notification for the affected user within 60 seconds of the event.
2. THE Portal SHALL send an email Notification to the affected user for the following events: account verification, account approval or rejection, application status change to Shortlisted, interview scheduled, and offer received.
3. WHEN a user reads a Notification, THE Portal SHALL mark it as read and visually distinguish it from unread notifications.
4. THE Portal SHALL display an unread notification count badge in the navigation bar for authenticated users.
5. THE Student SHALL be able to view a paginated list of all their Notifications sorted by most recent first.
6. WHEN an employer closes an Internship_Listing, THE Portal SHALL send a Notification to all students with a Submitted or Under_Review Application for that listing.

---

### Requirement 10: Reporting and Analytics

**User Story:** As an administrator, I want to generate reports and view analytics, so that I can monitor portal health and measure internship placement outcomes.

#### Acceptance Criteria

1. THE Administrator SHALL be able to generate a report displaying the total number of registered students, employers, published listings, and applications within a specified date range.
2. THE Administrator SHALL be able to view a breakdown of Application_Status counts per Internship_Listing and per employer.
3. THE Administrator SHALL be able to view the overall placement rate, defined as the ratio of Accepted applications to total submitted applications, for any specified date range.
4. WHEN an Administrator generates a report, THE Portal SHALL allow the report to be exported in CSV format.
5. THE Portal SHALL display an analytics dashboard to the Administrator showing trend charts for new registrations, new listings, and new applications over the past 30 days.
6. THE Administrator SHALL be able to filter all reports by academic institution, industry sector, and date range.
