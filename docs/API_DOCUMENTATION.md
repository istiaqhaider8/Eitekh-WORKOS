# Eitekh WorkOS: RESTful API Reference Manual

> **Base URL:** `/api`  
> **Authentication:** Bearer JWT / HttpOnly Session Cookie  
> **Response Format:** JSON (`application/json`)  
> **Status Codes:** Standard HTTP (200 OK, 201 Created, 400 Bad Request, 401 Unauthorized, 403 Forbidden, 404 Not Found)

---

## 1. Authentication & User Profile

### `POST /api/auth/login`
Authenticate user credentials and establish session.
- **Body:** `{ "email": "user@domain.com", "password": "Password123!" }`
- **Response (200):** `{ "user": { "id": "...", "email": "...", "isSuperAdmin": false } }`

### `POST /api/auth/register`
Register a new user account.
- **Body:** `{ "email": "...", "password": "...", "firstName": "...", "lastName": "..." }`

### `POST /api/auth/change-password`
Change current password with strength enforcement.
- **Body:** `{ "currentPassword": "...", "newPassword": "..." }`

### `GET /api/auth/sessions`
List all active login sessions for the authenticated user.

### `DELETE /api/auth/sessions`
Revoke active session(s).
- **Body:** `{ "sessionId": "..." }` or `{ "revokeAll": true }`

### `PATCH /api/auth/mfa`
Enable or disable Two-Factor Authentication (TOTP).

---

## 2. Organization & Workspace Management

### `GET /api/orgs/:id`
Retrieve organization metadata and seat count.

### `PATCH /api/orgs/:id`
Update organization configuration. Requires `org:settings`.

### `GET /api/orgs/:id/members`
List organization members and roles.

### `POST /api/orgs/:id/members`
Invite a new member to the organization. Requires `org:members`.
- **Body:** `{ "email": "...", "role": "ADMIN" | "MEMBER" }`

### `POST /api/workspaces`
Create a workspace under an organization.

### `PATCH /api/workspaces/:id`
Update workspace details or archive.

---

## 3. Project & Issue Operations

### `GET /api/projects/:id`
Fetch complete project details, workflows, statuses, and members.

### `GET /api/projects/:id/issues`
Query project issues with support for filtering, pagination, and sorting.
- **Query Params:** `statusId`, `assigneeId`, `sprintId`, `epicId`, `priority`, `search`

### `POST /api/projects/:id/issues`
Create a new issue. Requires `issues:create`.
- **Body:**
```json
{
  "title": "Implement OAuth2 Provider",
  "description": "Add Google and GitHub social logins",
  "issueType": "STORY",
  "priority": "HIGH",
  "estimatePoints": 5,
  "assigneeId": "usr_123"
}
```

### `PATCH /api/issues/:id`
Update an issue. Requires `issues:edit` (or `issues:transition` if updating status).

### `DELETE /api/issues/:id`
Delete an issue. Requires `issues:delete`.

### `PATCH /api/issues/bulk`
Perform batch updates on multiple issues. Requires `issues:bulk_edit`.
- **Body:** `{ "issueIds": ["..."], "updates": { "statusId": "...", "assigneeId": "..." } }`

---

## 4. Sprints & Epics

### `POST /api/sprints`
Create a new sprint. Requires `sprints:create`.

### `PATCH /api/sprints`
Start or complete a sprint. Requires `sprints:start` / `sprints:complete`.

### `DELETE /api/sprints`
Delete an unstarted sprint. Requires `sprints:delete`.

### `POST /api/epics`
Create an epic. Requires `epics:create`.

### `PATCH /api/epics/:id`
Update epic details. Requires `epics:edit`.

---

## 5. Workflows, Custom Fields & Automations

### `POST /api/workflows`
Create a custom workflow for a project. Requires `settings:workflows`.

### `POST /api/custom-fields`
Define a typed custom field. Requires `settings:custom_fields`.

### `POST /api/automations`
Create an event-driven automation rule. Requires `settings:automations`.

---

## 6. Import & Export

### `GET /api/projects/:id/export?format=csv`
Export project issues to CSV. Requires `export:csv`.

### `POST /api/projects/:id/import`
Bulk import issues from CSV. Requires `export:import_data`.
