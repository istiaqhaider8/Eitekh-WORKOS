// Shared Prisma `select` for User relations that are serialized to clients.
//
// Never use `include: { assignee: true }` on a User relation: `true` selects
// every column, including passwordHash, mfaSecret, recoveryCodes, resetToken
// and verificationToken. Use `{ select: publicUserSelect }` instead so secrets
// can never reach the browser.
export const publicUserSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  avatarUrl: true,
  jobTitle: true,
  // EMPLOYEE or CLIENT. Included here so every member and assignee list can
  // show it without each call site remembering to ask; it is ordinary
  // non-sensitive profile data, like jobTitle.
  userType: true,
} as const;

export const publicUserRelation = { select: publicUserSelect } as const;
