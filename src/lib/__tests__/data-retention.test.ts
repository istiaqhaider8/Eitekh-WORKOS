/**
 * Integration tests for data-retention.ts.
 * Tests the policy configuration layer (no DB required — policies are
 * purely derived from env vars). The purge functions are tested by
 * overriding the container's prisma dependency with a jest mock.
 */

import { getRetentionPolicies } from "../data-retention";
import { container } from "../container";

describe("getRetentionPolicies", () => {
  afterEach(() => {
    container.reset();
    // Clean up env overrides between tests
    delete process.env.SESSION_RETENTION_DAYS;
    delete process.env.NOTIFICATION_RETENTION_DAYS;
    delete process.env.ACTIVITY_LOG_RETENTION_DAYS;
    delete process.env.EMAIL_LOG_RETENTION_DAYS;
    delete process.env.AUDIT_LOG_RETENTION_DAYS;
  });

  it("returns a policy for each expected entity", () => {
    const policies = getRetentionPolicies();
    const entities = policies.map((p) => p.entity);
    expect(entities).toContain("Session");
    expect(entities).toContain("Notification");
    expect(entities).toContain("ActivityLog");
    expect(entities).toContain("EmailLog");
    expect(entities).toContain("EmailOutbox");
    expect(entities).toContain("PlatformAuditLog");
  });

  it("uses default retention days when env vars are absent", () => {
    const policies = getRetentionPolicies();
    const session = policies.find((p) => p.entity === "Session")!;
    const auditLog = policies.find((p) => p.entity === "PlatformAuditLog")!;
    expect(session.retentionDays).toBe(90);
    expect(auditLog.retentionDays).toBe(365);
  });

  it("respects env-var overrides", () => {
    process.env.SESSION_RETENTION_DAYS = "30";
    process.env.AUDIT_LOG_RETENTION_DAYS = "730";
    const policies = getRetentionPolicies();
    const session = policies.find((p) => p.entity === "Session")!;
    const auditLog = policies.find((p) => p.entity === "PlatformAuditLog")!;
    expect(session.retentionDays).toBe(30);
    expect(auditLog.retentionDays).toBe(730);
  });

  it("ignores invalid (non-positive) env-var values and falls back to default", () => {
    process.env.SESSION_RETENTION_DAYS = "-5";
    process.env.NOTIFICATION_RETENTION_DAYS = "0";
    const policies = getRetentionPolicies();
    const session = policies.find((p) => p.entity === "Session")!;
    const notification = policies.find((p) => p.entity === "Notification")!;
    expect(session.retentionDays).toBe(90);
    expect(notification.retentionDays).toBe(90);
  });

  it("ignores NaN env-var values and falls back to default", () => {
    process.env.EMAIL_LOG_RETENTION_DAYS = "not-a-number";
    const policies = getRetentionPolicies();
    const emailLog = policies.find((p) => p.entity === "EmailLog")!;
    expect(emailLog.retentionDays).toBe(90);
  });
});

describe("runDataRetention (mocked prisma)", () => {
  const mockDeleteMany = jest.fn().mockResolvedValue({ count: 0 });

  const mockPrisma = {
    session: { deleteMany: mockDeleteMany },
    otpCode: { deleteMany: mockDeleteMany },
    notification: { deleteMany: mockDeleteMany },
    activityLog: { deleteMany: mockDeleteMany },
    emailLog: { deleteMany: mockDeleteMany },
    emailOutbox: { deleteMany: mockDeleteMany },
    platformAuditLog: { deleteMany: mockDeleteMany },
  } as any;

  beforeEach(() => {
    container.override({ prisma: mockPrisma });
    mockDeleteMany.mockClear();
  });

  afterEach(() => {
    container.reset();
  });

  it("calls deleteMany for each entity", async () => {
    const { runDataRetention } = await import("../data-retention");
    const results = await runDataRetention();
    // One deleteMany call per entity, derived rather than hardcoded: a new
    // policy should extend the assertion, not break it and get the number
    // bumped without anyone checking the purge was wired up.
    const policyCount = getRetentionPolicies().length;
    expect(mockDeleteMany).toHaveBeenCalledTimes(policyCount);
    expect(results).toHaveLength(policyCount);
    results.forEach((r) => {
      expect(r.deletedCount).toBeGreaterThanOrEqual(0);
      expect(r.cutoffDate).toBeDefined();
    });
  });
});
