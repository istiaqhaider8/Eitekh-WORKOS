import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { assertProjectAccess } from "@/lib/tenant";
import { handleApiError } from "@/lib/api-error";
import { getStorage } from "@/lib/storage/factory";

/**
 * A4 — serve attachment content on demand.
 *
 * WHY THIS EXISTS
 *
 * Attachment content was only ever delivered inline, inside the issue payload,
 * because there was no endpoint to fetch it from — `/api/attachments/[id]` had
 * DELETE and nothing else. Every `GET /api/issues/[id]` therefore dragged every
 * attachment's full bytes through Postgres, the app and the wire, whether the
 * viewer opened them or not.
 *
 * Measured on the volume dataset: one issue with a single 380 KB attachment
 * returned a 689 KB payload, of which 380 KB was one file nobody had clicked.
 *
 * With this route the issue payload carries metadata only and content is
 * fetched when someone actually looks.
 *
 * WHAT IT DOES NOT FIX
 *
 * Files are still stored base64-encoded in a database column (see B3 in
 * IMPROVEMENT-PLAN.md). That remains wrong: it inflates the database, the
 * backups and replication. This route is the seam that makes fixing it
 * cheap — once objects live in S3, this becomes a redirect to a signed URL and
 * nothing else changes.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;

    const attachment = await prisma.attachment.findUnique({
      where: { id },
      select: {
        fileName: true,
        mimeType: true,
        fileUrl: true,
        storageKey: true,
        issue: { select: { projectId: true } },
      },
    });

    if (!attachment) {
      return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
    }

    // Authorize through the parent issue's project. Serving a file by its own
    // id without this is exactly the shape of the cross-tenant leaks the
    // isolation suite found twice.
    await assertProjectAccess(attachment.issue.projectId);

    /**
     * B3 — the object store first, when this row has been moved there.
     *
     * Three states coexist while the backfill runs, and all three are served:
     * a storageKey (the destination), an http(s) fileUrl (already external),
     * and a data: fileUrl (legacy base64, not yet moved). That is what lets
     * the migration be a background job rather than a deployment step.
     */
    const storage = getStorage();
    if (attachment.storageKey && storage) {
      const target = await storage.read(attachment.storageKey, {
        fileName: attachment.fileName,
        contentType: attachment.mimeType,
      });

      if (target.kind === "redirect") {
        // The bytes travel from the store to the client and never through
        // this process. The URL is short-lived and was minted only after the
        // project check above.
        return NextResponse.redirect(target.url, 302);
      }

      return new NextResponse(target.body, {
        headers: {
          "Content-Type": attachment.mimeType || "application/octet-stream",
          "Content-Length": String(target.size),
          // `attachment` rather than `inline`: never let an uploaded file
          // render as a document in this application's own origin.
          "Content-Disposition": `attachment; filename="${encodeURIComponent(attachment.fileName)}"`,
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "private, max-age=300",
        },
      });
    }

    const url = attachment.fileUrl;

    // Externally hosted: hand the client the location rather than proxying
    // bytes through the app.
    if (/^https?:\/\//i.test(url)) {
      return NextResponse.redirect(url, 302);
    }

    if (url.startsWith("data:")) {
      const comma = url.indexOf(",");
      const meta = url.slice(5, comma);
      const isBase64 = meta.endsWith(";base64");
      const declaredType = meta.replace(/;base64$/, "") || "application/octet-stream";
      const body = url.slice(comma + 1);

      const bytes = isBase64
        ? Buffer.from(body, "base64")
        : Buffer.from(decodeURIComponent(body), "utf8");

      return new NextResponse(new Uint8Array(bytes), {
        headers: {
          // Trust the stored mimeType over the data URI's own claim, since the
          // stored one passed the upload allow-list.
          "Content-Type": attachment.mimeType || declaredType,
          "Content-Length": String(bytes.length),
          // `attachment` rather than `inline`: never let an uploaded file
          // render as a document in the application's own origin.
          "Content-Disposition": `attachment; filename="${encodeURIComponent(attachment.fileName)}"`,
          "X-Content-Type-Options": "nosniff",
          // Private: this is tenant data behind an authorization check, and
          // must not be cached by a shared proxy.
          "Cache-Control": "private, max-age=300",
        },
      });
    }

    // A relative path — a legacy shape. Not resolvable without knowing where it
    // points, so it is reported rather than guessed at.
    return NextResponse.json(
      { error: "This attachment has no retrievable content", fileUrl: url },
      { status: 415 },
    );
  } catch (error) {
    return handleApiError(error, "attachments/[id]/content");
  }
}
