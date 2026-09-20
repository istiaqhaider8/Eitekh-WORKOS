/**
 * EMAIL_DISABLED — the switch that actually stops outbound mail.
 *
 * WHY IT HAD TO EXIST
 *
 * Unsetting SMTP_HOST and SMTP_PASS does not stop this application sending
 * email. Two mechanisms defeat it, and they stack:
 *
 *   1. `getEmailConfig` reads credentials from the `systemEmailConfig` TABLE
 *      first and treats the environment only as a fallback. A row written
 *      once — by an admin screen, or by getEmailConfig's own auto-create —
 *      leaves every later process able to reach real inboxes.
 *   2. Next.js loads `.env` automatically, so unsetting a variable in the
 *      shell before starting the server does nothing at all.
 *
 * Together those sent a real password-reset code to a real address from this
 * machine, while the operator had deliberately removed every SMTP variable
 * and believed sending was impossible.
 *
 * So the guard is read from the environment ONLY, and is consulted before the
 * config is loaded. A kill switch that the database can override is not a
 * kill switch.
 */

describe("isEmailDisabled", () => {
  const original = process.env.EMAIL_DISABLED;

  afterEach(() => {
    if (original === undefined) delete process.env.EMAIL_DISABLED;
    else process.env.EMAIL_DISABLED = original;
    jest.resetModules();
  });

  function load() {
    let isEmailDisabled!: () => boolean;
    jest.isolateModules(() => {
      isEmailDisabled = require("../email").isEmailDisabled;
    });
    return isEmailDisabled;
  }

  it("is OFF by default, so this cannot silently break a real deployment", () => {
    delete process.env.EMAIL_DISABLED;
    expect(load()()).toBe(false);
  });

  it.each(["1", "true", "TRUE", "yes", " true ", "Yes"])(
    "treats %p as disabled",
    (value) => {
      // Generous about spelling on purpose. Someone reaching for this is
      // trying to stop mail reaching real people; a value that looks like
      // "on" but is not recognised fails in the dangerous direction.
      process.env.EMAIL_DISABLED = value;
      expect(load()()).toBe(true);
    }
  );

  it.each(["", "0", "false", "no", "off"])("treats %p as enabled", (value) => {
    process.env.EMAIL_DISABLED = value;
    expect(load()()).toBe(false);
  });

  it("does not treat an arbitrary string as disabled", () => {
    /**
     * The asymmetry is deliberate.
     *
     * Unrecognised values must mean ENABLED, because the alternative is that a
     * typo in production silently stops every password reset, OTP and
     * invitation — and each of those failures looks like a user error rather
     * than a configuration one. Nobody finds out until somebody cannot get
     * into their account.
     *
     * instrumentation.ts warns loudly at boot when the switch IS set in
     * production, which covers the other direction.
     */
    process.env.EMAIL_DISABLED = "disabled";
    expect(load()()).toBe(false);
  });
});
