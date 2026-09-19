/**
 * Say WHY a CI check failed, somewhere a reader can actually get to.
 *
 * On a public repository, Actions job logs are readable only with admin
 * rights: the REST endpoint answers 403 and the web log endpoint 404s to
 * anyone not signed in. Everyone else gets "Process completed with exit code
 * 1" and nothing else — which is a useless signal for the drills, whose whole
 * purpose is to tell you that your backups or your key rotation are broken.
 *
 * Annotations are attached to the check run rather than buried in the log, and
 * they ARE public. So a failing check emits one, and the drills emit their
 * environment as a notice on every run, because "which client, against which
 * server, on which platform" is the first question anyone asks and the answer
 * moves under you when a hosted runner image updates.
 *
 * This exists as a module because the same need turned up in the second drill
 * within an hour of the first, and a copy of it in every script is a set of
 * copies that drift.
 */

const ENABLED = Boolean(process.env.GITHUB_ACTIONS);

/**
 * Emit one workflow command.
 *
 * Newlines and percent signs must be encoded or they terminate the command
 * early and the annotation arrives truncated — silently, which would make
 * this worse than no annotation at all.
 */
export function ghCommand(kind, title, line) {
  if (!ENABLED) return;
  const encoded = String(line)
    .replace(/%/g, "%25")
    .replace(/\r/g, "%0D")
    .replace(/\n/g, "%0A");
  console.log(`::${kind} title=${title}::${encoded}`);
}

/** A failure annotation. */
export const ghError = (title, line) => ghCommand("error", title, line);

/** An informational annotation, shown on passing runs too. */
export const ghNotice = (title, line) => ghCommand("notice", title, line);

/** Whether annotations are going anywhere, for callers that want to branch. */
export const annotationsEnabled = ENABLED;
