# NivHR – AI-Powered HR Operations & Employee Management System

## 1. Project Overview

Build NivHR, an AI-powered HR operations and employee management platform.

The application supports two user roles:
- `hr`
- `employee`

There is no public registration. HR creates employee accounts.

## 2. Technology Stack

- Frontend: React, Vite, Tailwind CSS, React Router
- Backend: Node.js, Express.js
- Database: MongoDB with Mongoose
- Authentication: JWT and bcryptjs
- Validation: Zod
- Rate limiting: express-rate-limit
- AI: Gemini API
- Email: Nodemailer
- Charts: Recharts

Use JavaScript ES modules only. Do not introduce TypeScript.

## 3. Project Structure

- `server/` – Backend application
- `client/` – Frontend application
- Backend architecture: Routes → Controllers → Services
- Keep database models in `server/src/models/`.
- Keep database configuration in `server/src/config/`.
- Keep reusable middleware in `server/src/middleware/`.
- Keep business logic in service files.

Follow the existing folder structure and naming conventions. Do not create unnecessary folders or files.

## 4. User Roles & Access

Only two roles are allowed:
- `hr`
- `employee`

Rules:
- Never introduce an `admin` role or additional roles without explicit approval.
- No public registration.
- HR is responsible for creating employee accounts.
- Employees must only access their own personal data.
- HR can access HR management features according to the required authorization rules.

## 5. Authentication & Authorization

- Use JWT authentication with an 8-hour expiration.
- Use bcryptjs for password hashing and password comparison.
- All `/api/*` routes must be protected except `/api/health` and `/api/auth/login`.
- Always load the current user from MongoDB when verifying a JWT.
- Never trust client-supplied roles or rely only on the role stored in a JWT for authorization.
- Users with `isActive: false` cannot log in or access protected APIs.
- Authentication (`authenticate`) and role authorization (`requireRole`) must be separate middleware.
- Use HTTP 401 for unauthenticated requests.
- Use HTTP 403 for authenticated users without sufficient permissions.
- Never expose password hashes in API responses.
- Do not implement public registration.

## 6. Security & Data Protection

- Never hardcode secrets, API keys, database credentials or JWT secrets.
- Store sensitive configuration in environment variables.
- Never commit `.env` files.
- Keep `.env.example` updated with placeholder values only.
- Validate incoming API request data using Zod.
- Sanitize and validate data before database operations.
- Use centralized error handling.
- Maintain consistent API response formats.
- Do not expose internal stack traces or sensitive information in production responses.
- Apply appropriate authentication, authorization and rate limiting to sensitive endpoints.
- Never send passwords, tokens, JWT secrets or unnecessary personal data to external APIs.
- Keep `.gitignore` updated.
- Never commit `.env`, credentials, API keys or other secrets.
- Use clear and meaningful commit messages.
- Do not force-push or modify Git history without explicit approval.

## 7. Backend Architecture & Coding Rules

- Follow Routes → Controllers → Services.
- Routes define endpoints and attach middleware.
- Controllers handle HTTP requests and responses.
- Services contain business logic and database operations.
- Models define Mongoose schemas.
- Middleware handles authentication, authorization, validation and errors.
- Avoid putting complex business logic directly inside route files or controllers.
- Use async/await for asynchronous operations.
- Handle errors consistently.
- Keep functions small, readable and reusable.
- Avoid unnecessary dependencies and duplicate logic.
- Use meaningful variable, function and file names.
- Make small, focused changes.
- Do not rewrite existing working code unnecessarily.

## 8. Database Rules

- Use MongoDB with Mongoose.
- Do not introduce another database technology without explicit approval.
- Define appropriate schema validations and indexes.
- Use timestamps where appropriate.
- Handle missing records and duplicate records safely.
- Employees must only access their own records.
- Scope employee-specific queries using the authenticated user's ID.
- Never rely on frontend restrictions for data security.
- Enforce permissions in backend services and APIs.

## 9. AI Integration Rules

- All Gemini API calls must go through `server/src/services/aiService.js`.
- Do not call Gemini directly from controllers or routes.
- Keep AI integration separate from ordinary business logic.
- Handle AI API errors, timeouts and unavailable responses gracefully.
- Do not expose API keys to the frontend.

### AI Safety

- AI output is advisory only.
- HR makes all final HR decisions, including leave approval and rejection.
- AI must never independently make authorization, leave approval or other business decisions.
- AI features must respect the logged-in user's permissions.
- Employees must only receive information they are authorized to access.
- Never send passwords, tokens or unnecessary personal information to AI APIs.
- Validate LLM outputs using Zod before using them.
- Never execute LLM output as a raw database query or arbitrary code.
- For natural-language analytics, convert AI output into a validated, restricted query structure.
- Enforce role-based data access in the backend, regardless of AI output.
- AI-generated answers must be grounded in retrieved policy documents or actual database results where applicable.
- If information is unavailable, the AI must clearly communicate that instead of inventing an answer.
- Log AI call metadata in AuditLog without storing secrets or unnecessary personal data.

## 10. Email & Notifications

- All email operations must go through `server/src/services/notificationService.js`.
- Do not send emails directly from controllers or routes.
- Send emails asynchronously.
- Catch email errors so email failures never undo successful database operations.
- Database changes must be saved before sending notifications.
- Avoid duplicate notifications.
- Never expose email credentials or SMTP configuration.

## 11. Business Logic Rules

- Leave balance calculations must use normal JavaScript logic, never AI.
- Leave overlap detection must use normal JavaScript logic, never AI.
- Attendance calculations must use deterministic backend logic.
- HR retains final authority over employee and leave-related decisions.
- Do not use AI for calculations that can be handled reliably using normal code.

## 12. Project Scope

Implement only the agreed NivHR features:
- Authentication and role-based access.
- Employee management.
- Attendance management.
- Leave management.
- HR dashboard and analytics.
- Email notifications.
- AI HR Policy Assistant using RAG.
- AI Leave Review Copilot.
- Natural-language HR analytics.

Do not add the following without explicit approval:
- Employee onboarding or onboarding task management.
- Payroll management.
- Biometric or GPS attendance.
- AI performance evaluation.
- Additional user roles.
- Multiple AI agents.
- Public registration.
- Stretch features such as attendance anomaly detection.

Any stretch feature, including attendance anomaly detection, requires explicit approval before implementation.

## 13. Environment & Configuration

- Backend environment variables belong in `server/.env`.
- Keep `server/.env.example` as a template containing placeholder values.
- Never expose actual secrets in source code, logs, screenshots or GitHub.
- Run all npm commands inside the relevant application folder.
- Backend npm commands must run inside `server/`.
- Do not create unnecessary root-level package files.

## 14. Testing & Quality Checks

- Test each module before proceeding to the next.
- Check syntax and imports after making changes.
- Test successful and unsuccessful API scenarios.
- Test authentication and authorization boundaries.
- Test validation failures and error handling.
- Test inactive-user restrictions.
- Test employee data isolation.
- Test database operations and edge cases.
- Mention tests that could not be performed.
- Do not claim tests passed unless they were actually executed.

## 15. Development Workflow

- Read this `AGENTS.md` before making changes.
- Understand the existing implementation before modifying files.
- Make only the changes requested in the current task.
- Do not implement future modules prematurely.
- Explain files created and modified.
- Explain important implementation decisions in simple terms.
- Provide commands to run and test the implementation.
- Do not commit changes automatically.
- Wait for review before moving to the next module.
- Do not add features that were not requested.