/**
 * Whether a decision card follows its decision, or stays where a person put it.
 *
 * This is the judgement in the whole feature, so it is a pure function and it
 * is tested exhaustively rather than by example. Getting it wrong in either
 * direction is bad in a specific way:
 *
 *   - Too eager, and the software drags cards out from under people. Somebody
 *     moves a card into progress, a colleague edits the decision, and the
 *     card jumps back. Nobody trusts the board after that happens twice.
 *
 *   - Too timid, and the workshop and the board disagree forever. A decision
 *     changed from Configure to Adopt leaves a card sitting in Backlog with
 *     nothing saying why.
 *
 * The rule: the card follows the decision until a person moves it; after that
 * it is theirs.
 */

import { decideCardAction } from "@/lib/activate-board";

const BACKLOG = "status-backlog";
const DONE = "status-done";
const IN_PROGRESS = "status-in-progress";

describe("Deciding what to do with an existing card", () => {
  it("moves it when the decision changed and nobody has touched it", () => {
    // It is exactly where the previous decision filed it, so re-filing is
    // invisible to everyone and keeps the board true.
    expect(
      decideCardAction({
        currentStatusId: BACKLOG,
        previousExpectedStatusId: BACKLOG,
        nextExpectedStatusId: DONE,
      })
    ).toBe("move");

    expect(
      decideCardAction({
        currentStatusId: DONE,
        previousExpectedStatusId: DONE,
        nextExpectedStatusId: BACKLOG,
      })
    ).toBe("move");
  });

  it("does nothing when the new decision files it where it already is", () => {
    // Configure to Extend, say: both Backlog. Writing the same status back
    // would be a pointless update and a pointless line in the activity log.
    expect(
      decideCardAction({
        currentStatusId: BACKLOG,
        previousExpectedStatusId: BACKLOG,
        nextExpectedStatusId: BACKLOG,
      })
    ).toBe("unchanged");
  });

  it("leaves it alone once somebody has moved it", () => {
    // In Progress is nowhere any decision would have filed it, so a person
    // put it there on purpose.
    expect(
      decideCardAction({
        currentStatusId: IN_PROGRESS,
        previousExpectedStatusId: BACKLOG,
        nextExpectedStatusId: DONE,
      })
    ).toBe("leave_alone");
  });

  it("leaves it alone even when the move happens to agree with the new decision", () => {
    /**
     * Somebody dragged the card to Done, and the decision then changed to
     * Adopt, which also means Done.
     *
     * Still `leave_alone`, not `unchanged`. The distinction matters because
     * it is what the caller reports: saying "left where you put it" when a
     * person has taken ownership of a card is true, and saying "nothing to
     * do" would quietly claim this feature is still in charge of it.
     */
    expect(
      decideCardAction({
        currentStatusId: DONE,
        previousExpectedStatusId: BACKLOG,
        nextExpectedStatusId: DONE,
      })
    ).toBe("leave_alone");
  });

  it("treats a card moved and then moved back as untouched", () => {
    // There is no memory of the journey, only of where it ended up. A card
    // returned to where generation put it is indistinguishable from one that
    // never moved, and pretending otherwise would need a history nobody is
    // keeping.
    expect(
      decideCardAction({
        currentStatusId: BACKLOG,
        previousExpectedStatusId: BACKLOG,
        nextExpectedStatusId: DONE,
      })
    ).toBe("move");
  });
});
