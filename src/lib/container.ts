/**
 * Lightweight service container for dependency injection / testability.
 *
 * Production code uses the real singletons by default.
 * In tests, call `container.override({ ... })` before your test and
 * `container.reset()` in afterEach to restore the originals.
 *
 * Example (Jest):
 *   import { container } from '@/lib/container';
 *   import { mockDeep } from 'jest-mock-extended';
 *   import type { PrismaClient } from '@prisma/client';
 *
 *   const mockPrisma = mockDeep<PrismaClient>();
 *   beforeEach(() => container.override({ prisma: mockPrisma }));
 *   afterEach(() => container.reset());
 */

import { prisma as _prisma } from './prisma';
import { notificationEngine as _notificationEngine } from './notifications';
import { syncEngine as _syncEngine } from './sync-engine';

type ContainerServices = {
  prisma: typeof _prisma;
  notificationEngine: typeof _notificationEngine;
  syncEngine: typeof _syncEngine;
};

const defaults: ContainerServices = {
  prisma: _prisma,
  notificationEngine: _notificationEngine,
  syncEngine: _syncEngine,
};

let _current: ContainerServices = { ...defaults };

export const container = {
  get prisma() { return _current.prisma; },
  get notificationEngine() { return _current.notificationEngine; },
  get syncEngine() { return _current.syncEngine; },

  override(overrides: Partial<ContainerServices>) {
    _current = { ..._current, ...overrides };
  },

  reset() {
    _current = { ...defaults };
  },
};
