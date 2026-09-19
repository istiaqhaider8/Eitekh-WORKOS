# Deployment artifacts

Scheduler units for the work the application deliberately does **not** schedule
itself.

## Why none of this is inside the app

Three jobs need to run on a clock: alert evaluation, recurring-task generation,
and backups. All three are driven from outside the process.

A `setInterval` in module scope runs once per **instance**. Two instances means
two evaluations of every alert rule and two pages for one condition, two sets of
generated recurring tasks, and two concurrent `pg_dump`s. On a serverless host
it may not fire at all. This is the same defect PROD-2 and PROD-3 removed from
the rate limiter and the sync bus, and re-introducing it for the scheduler would
be the same bug wearing a different hat.

So the scheduler is explicit, and lives here.

## Install (systemd)

```sh
sudo install -d -m 0700 -o root -g root /etc/eitekh
sudo install -m 0600 -o root -g root /dev/null /etc/eitekh/alerts.env
sudo $EDITOR /etc/eitekh/alerts.env      # see "Environment file" below

sudo cp deploy/systemd/eitekh-*.service deploy/systemd/eitekh-*.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now eitekh-alerts.timer eitekh-recurring-tasks.timer
```

Then **confirm it is actually scheduled** — the failure mode this whole phase
was about is a safety net that everybody believes in and nobody checked:

```sh
systemctl list-timers 'eitekh-*'          # NEXT column must show a real time
sudo systemctl start eitekh-alerts.service    # run one cycle by hand
journalctl -u eitekh-alerts.service -n 20     # it must not be a 403 or a 503
```

A 503 means `ALERT_CHECK_SECRET` is unset in the application's environment. A
403 means the value in `/etc/eitekh/alerts.env` does not match it. Both exit
non-zero because of `curl --fail`; without that flag curl exits 0 on any
response it received, and a permanently rejected alert check looks like a
permanently healthy one.

## Install (cron)

For hosts without systemd, `deploy/cron/eitekh.crontab` carries the same three
jobs. Read the header — it is an `/etc/cron.d` file, so it has a user field and
`crontab -e` will reject it, and `MAILTO` is the only way cron reports a
failure.

## Environment file

`/etc/eitekh/alerts.env`, mode 0600, owned by root:

```
APP_URL=http://127.0.0.1:3000
ALERT_CHECK_SECRET=<same value as the application's ALERT_CHECK_SECRET>
RECURRING_TASKS_SECRET=<same value as the application's RECURRING_TASKS_SECRET>
DATABASE_URL=<postgres url for the backup job>
BACKUP_ENCRYPTION_KEY=<64 hex chars, NOT the field encryption key>
```

Secrets are here and not in the unit files because unit files are
world-readable — a secret in one is a secret in `systemctl cat`. They are not
on the cron command line because that would put them in `ps` for the duration
of every run.

`APP_URL` should point at **one** instance, not at a load balancer. Alert state
— the previous counter sample and the per-rule cooldowns — is per-process. Sent
round-robin across several instances, every call lands on a process that has
never sampled before, so every window reads as an enormous delta and the
cooldown never applies.

## Verification status

These units are **written but not executed**. This host is Windows; there is no
systemd and no cron here, so nothing below the syntax level has been checked:

- not verified: that the units load (`systemd-analyze verify`)
- not verified: that the timers fire on schedule
- not verified: that `curl --fail` returns non-zero against the real route

What *has* been verified locally is the thing the units call: the alert-check
route evaluates the rules and dispatches firings, proven end to end by
`node scripts/alert-drill.mjs` against a running production build. The schedule
around it is the unverified part, which is why the install steps above end with
a manual `systemctl start` and a look at the journal rather than with `enable`.
