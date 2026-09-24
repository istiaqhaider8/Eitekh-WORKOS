/**
 * Unit tests for the Ticket Management Module domain validation,
 * state machine transitions, and key allocation patterns.
 */

import {
  ticketCreateSchema,
  ticketUpdateSchema,
  ticketStatusTransitionSchema,
  ticketAssignSchema,
  ticketCommentCreateSchema,
  TICKET_STATUSES,
  TICKET_CATEGORIES,
  TICKET_PRIORITIES,
} from "@/lib/validation";
import { allocateTicketKey } from "@/lib/ticket-keys";

describe("Ticket Validation Schemas", () => {
  describe("ticketCreateSchema", () => {
    it("validates a standard ticket submission", () => {
      const valid = {
        title: "Client login fails with OAuth error",
        description: "Steps to reproduce: ...",
        category: "BUG_REPORT",
        priority: "HIGH",
        dueDate: "2026-10-01T00:00:00.000Z",
      };
      const result = ticketCreateSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it("defaults category to GENERAL and priority to MEDIUM", () => {
      const minimal = {
        title: "Need help configuring SSO integration",
      };
      const result = ticketCreateSchema.safeParse(minimal);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.category).toBe("GENERAL");
        expect(result.data.priority).toBe("MEDIUM");
      }
    });

    it("rejects titles that are too short", () => {
      const invalid = { title: "No" };
      const result = ticketCreateSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it("rejects invalid categories and priorities", () => {
      expect(ticketCreateSchema.safeParse({ title: "Valid Title", category: "INVALID" }).success).toBe(false);
      expect(ticketCreateSchema.safeParse({ title: "Valid Title", priority: "URGENT_NOW" }).success).toBe(false);
    });
  });

  describe("ticketStatusTransitionSchema", () => {
    it("accepts valid status transitions", () => {
      expect(ticketStatusTransitionSchema.safeParse({ status: "UNDER_REVIEW" }).success).toBe(true);
      expect(ticketStatusTransitionSchema.safeParse({ status: "APPROVED", note: "Approved for sprint" }).success).toBe(true);
      expect(
        ticketStatusTransitionSchema.safeParse({
          status: "REJECTED",
          rejectionReason: "Out of scope for current phase",
        }).success
      ).toBe(true);
    });

    it("supports optimistic locking version field", () => {
      const result = ticketStatusTransitionSchema.safeParse({
        status: "UNDER_REVIEW",
        version: 3,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.version).toBe(3);
      }
    });
  });

  describe("ticketCommentCreateSchema", () => {
    it("accepts comments with markdown content", () => {
      const comment = {
        content: "We are currently investigating the issue logs.",
        isInternal: true,
      };
      const result = ticketCommentCreateSchema.safeParse(comment);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.isInternal).toBe(true);
      }
    });

    it("defaults isInternal to false", () => {
      const comment = {
        content: "Hello, could you provide the screenshot?",
      };
      const result = ticketCommentCreateSchema.safeParse(comment);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.isInternal).toBe(false);
      }
    });
  });
});

describe("Ticket Key Allocation", () => {
  it("allocates the next sequential key and reconciles counter", async () => {
    const mockTx: any = {
      ticket: {
        findFirst: jest.fn().mockResolvedValue({ ticketNumber: 5 }),
      },
      project: {
        update: jest
          .fn()
          // First call: increment
          .mockResolvedValueOnce({
            id: "proj_1",
            key: "HELIOS",
            ticketCounter: 2,
            workflows: [{ statuses: [{ id: "status_1", position: 1 }] }],
          })
          // Second call: jump counter past max existing (5 + 1 = 6)
          .mockResolvedValueOnce({
            id: "proj_1",
            key: "HELIOS",
            ticketCounter: 6,
            workflows: [{ statuses: [{ id: "status_1", position: 1 }] }],
          }),
      },
    };

    const allocated = await allocateTicketKey(mockTx, "proj_1");
    expect(allocated.ticketNumber).toBe(6);
    expect(allocated.ticketKey).toBe("HELIOS-TKT-6");
    expect(mockTx.project.update).toHaveBeenCalledTimes(2);
  });
});
