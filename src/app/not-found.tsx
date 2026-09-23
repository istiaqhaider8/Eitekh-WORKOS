import Link from "next/link";

/**
 * The page for something that is not there.
 *
 * Without this file Next serves its own default: black-on-white "404 This
 * page could not be found", no header, no theme, and — the part that
 * matters — no way back. A person who opens a bookmark to a project that has
 * since been deleted lands there and has to edit the URL by hand.
 *
 * It is reached by every `notFound()` in the app, and the project page calls
 * it whenever the id in the URL no longer resolves. Deleting a project is
 * the ordinary way that happens, and a stale tab or a bookmark is the
 * ordinary way it is noticed.
 *
 * Deliberately vague about WHY. This same page answers a deleted project, a
 * mistyped URL and a project in somebody else's organization, and telling an
 * outsider which of those it was would confirm that a particular id exists.
 * The tenant guard on the project route already takes that care; saying too
 * much here would give it away.
 */
export default function NotFound() {
  return (
    <main className="min-h-screen bg-background text-foreground flex items-center justify-center p-6">
      <div className="w-full max-w-md text-center space-y-5">
        <p className="text-5xl font-black tracking-tight text-muted-foreground">404</p>

        <div className="space-y-2">
          <h1 className="text-lg font-bold">This page could not be found</h1>
          <p className="text-sm text-muted-foreground">
            The link may be out of date, or whatever was here has been deleted or is no
            longer shared with you.
          </p>
        </div>

        <div className="flex items-center justify-center gap-2 pt-1">
          <Link
            href="/"
            className="px-4 py-2 text-xs font-semibold rounded-lg bg-primary text-primary-foreground hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            Go to your projects
          </Link>
        </div>
      </div>
    </main>
  );
}
