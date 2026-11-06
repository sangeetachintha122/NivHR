# AI HR Operations Platform

Stack: React (Vite) + Express + MongoDB (Mongoose). JavaScript only.

Roles: only `hr` and `employee`. No public registration.

Structure: server/ (routes -> controllers -> services), client/

Rules:
- Use Zod for validation, JWT + bcryptjs for authentication.
- All Gemini calls go through server/src/services/aiService.js.
- All emails go through server/src/services/notificationService.js.
- Leave balance and overlap logic must use normal JavaScript, never AI.
- Emails are sent asynchronously, errors are caught and must never block the API.
- Keep secrets in environment variables.
- Make small changes; don't add features I didn't ask for.
- Test each module before proceeding.
- Do not implement employee onboarding or payroll.