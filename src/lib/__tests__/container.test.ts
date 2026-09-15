/**
 * Integration tests for the service container (src/lib/container.ts).
 * Verifies that override/reset works correctly for test isolation.
 */

import { container } from "../container";

describe("container", () => {
  afterEach(() => {
    container.reset();
  });

  it("exposes the real prisma singleton by default", () => {
    expect(container.prisma).toBeDefined();
  });

  it("exposes the real notificationEngine by default", () => {
    expect(container.notificationEngine).toBeDefined();
    expect(typeof container.notificationEngine.dispatch).toBe("function");
  });

  it("exposes the real syncEngine by default", () => {
    expect(container.syncEngine).toBeDefined();
  });

  it("returns override when overridden", () => {
    const fakePrisma = { user: { findMany: jest.fn() } } as any;
    container.override({ prisma: fakePrisma });
    expect(container.prisma).toBe(fakePrisma);
  });

  it("restores original after reset", () => {
    const original = container.prisma;
    const fakePrisma = {} as any;
    container.override({ prisma: fakePrisma });
    expect(container.prisma).toBe(fakePrisma);
    container.reset();
    expect(container.prisma).toBe(original);
  });

  it("only overrides the specified services", () => {
    const originalEngine = container.notificationEngine;
    container.override({ prisma: {} as any });
    expect(container.notificationEngine).toBe(originalEngine);
  });
});
