/**
 * A1 — hand libpq a URL it will actually accept.
 *
 * WHAT WENT WRONG
 *
 * `pg_dump` and `pg_restore` connect through libpq, and libpq rejects any
 * query parameter it does not recognise:
 *
 *     pg_dump: error: invalid URI query parameter: "schema"
 *
 * Prisma's `DATABASE_URL` always carries at least one of those. `?schema=` is
 * how Prisma names the search path, and `connection_limit`, `pool_timeout` and
 * `pgbouncer` are equally common. None is a libpq keyword. So the one
 * environment variable every operator has — the one DEPLOYMENT.md tells them
 * to use — is the one thing the backup scripts could not consume.
 *
 * The node `pg` driver ignores unknown parameters, which is why this stayed
 * invisible: the drill connected fine to count rows and read the server
 * version, and then pg_dump failed on the same string. Every check downstream
 * failed as a consequence, so the visible symptom was nine failures with no
 * obvious common cause.
 *
 * WHY STRIP RATHER THAN TRANSLATE
 *
 * `schema` has an apparent pg_dump equivalent in `--schema=<name>`, and using
 * it would be wrong. `--schema` narrows the dump to that one schema, so a
 * DATABASE_URL naming the application's schema would silently produce a backup
 * missing everything else in the database. A backup that quietly excludes
 * things is the exact failure this drill exists to catch, and it would be
 * caught by nothing else: the restore verifier compares the `public` schema,
 * which is precisely the part that would still match.
 *
 * Dropping the parameter keeps the dump whole. The search path matters to an
 * application issuing queries; it does not change what a full dump contains.
 *
 * WHY AN ALLOW-LIST
 *
 * An unrecognised parameter is fatal to libpq, so the cost of dropping one it
 * did know is a lost option, while the cost of keeping one it does not is a
 * backup that never runs. The list below is libpq's own keyword set. Anything
 * outside it is dropped and named, because a silent strip of `sslmode` would
 * be its own incident.
 */

/** libpq's connection keywords. See the PostgreSQL libpq documentation. */
const LIBPQ_PARAMS = new Set([
  "host", "hostaddr", "port", "dbname", "user", "password", "passfile",
  "require_auth", "channel_binding", "connect_timeout", "client_encoding",
  "options", "application_name", "fallback_application_name",
  "keepalives", "keepalives_idle", "keepalives_interval", "keepalives_count",
  "tcp_user_timeout", "replication", "gssencmode", "sslmode", "requiressl",
  "sslcompression", "sslcert", "sslkey", "sslpassword", "sslcertmode",
  "sslrootcert", "sslcrl", "sslcrldir", "sslsni", "requirepeer",
  "ssl_min_protocol_version", "ssl_max_protocol_version",
  "krbsrvname", "gsslib", "gssdelegation", "service",
  "target_session_attrs", "load_balance_hosts",
]);

/**
 * Strip the parameters libpq would refuse.
 *
 * Returns the cleaned URL and the names that were removed, so the caller can
 * say so out loud. Never returns the URL itself in the `dropped` list — these
 * strings contain a password and are printed.
 *
 * A URL this cannot parse is returned untouched: a connection string may be in
 * libpq's `key=value` form rather than a URI, and that form is already
 * something libpq accepts.
 */
export function toLibpqUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { url, dropped: [] };
  }

  if (!/^postgres(ql)?:$/.test(parsed.protocol)) return { url, dropped: [] };

  const dropped = [];
  for (const key of [...parsed.searchParams.keys()]) {
    if (LIBPQ_PARAMS.has(key)) continue;
    dropped.push(key);
    parsed.searchParams.delete(key);
  }

  if (dropped.length === 0) return { url, dropped: [] };

  // An empty query string leaves a trailing "?", which libpq tolerates but
  // which shows up in logs and looks like a truncated URL.
  let out = parsed.toString();
  if (out.endsWith("?")) out = out.slice(0, -1);
  return { url: out, dropped };
}

/**
 * The same thing, for a caller that just wants the URL and a line on stderr.
 *
 * `label` names the tool, so the message says which command was about to fail.
 */
export function libpqUrlFor(label, url) {
  const { url: cleaned, dropped } = toLibpqUrl(url);
  if (dropped.length > 0) {
    console.log(
      `[${label}] dropped ${dropped.length} connection parameter(s) libpq does not accept: ` +
        `${dropped.join(", ")}. These are Prisma's, not PostgreSQL's; the dump covers the ` +
        `whole database either way.`
    );
  }
  return cleaned;
}
