# NivHR

NivHR is an AI-powered HR Operations and Employee Management System. Its frontend provides role-based workspaces for HR teams and employees, backed by the NivHR API.

## Frontend modules

- **Authentication:** Sign in for HR and Employee accounts. HR creates accounts; there is no public signup.
- **HR Dashboard:** Overview of HR and leave activity.
- **Employee Management:** HR can browse and manage employee records and profiles.
- **Leave Management:** Employees apply for and cancel pending requests; HR reviews requests by approving or rejecting them.
- **Attendance Management:** Check in and out, view attendance history, and see late-arrival status.
- **AI HR Policy Assistant:** Ask questions about indexed HR policies using retrieval-augmented generation (RAG).
- **AI Leave Review Copilot:** HR can review advisory AI analysis for pending leave requests.
- **Natural Language HR Analytics:** Ask questions about workforce and leave data and view structured results and charts.
- **Employee Profile:** View the signed-in user's profile; HR can also view employee profiles.

## Technology

- React
- Vite
- React Router
- Tailwind CSS
- Axios
- Recharts
- Lucide React

## Prerequisites

- Node.js and npm compatible with the installed Vite version.
- A running NivHR backend accessible from the browser.

## Install and run

From the `client/` directory:

```sh
npm install
```

Copy `.env.example` to `.env` and configure the backend API root:

```env
VITE_API_BASE_URL=http://localhost:5000/api
```

This is the local default. Set the value to the API root for your environment; do not put secrets in this frontend variable. The backend must be running and reachable at that URL for sign-in and data-backed modules to work.

Start the development server:

```sh
npm run dev
```

Create and preview a production build:

```sh
npm run build
npm run preview
```

## Project structure

```text
src/
  api/            Axios client and API helpers
  components/     Shared UI, layout, and employee components
  context/        Authentication state
  pages/
    auth/         Sign-in page
    hr/           HR employee, leave review, and analytics pages
    shared/       Dashboard, leave, attendance, policy, and profile pages
  routes/         Authentication and role-based route guards
  utils/          Formatting helpers
```
