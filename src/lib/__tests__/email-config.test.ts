/**
 * SMTP configuration must never resolve to NaN.
 *
 * WHAT WAS WRONG
 *
 * Three places in email.ts read the port as:
 *
 *     process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : 587
 *
 * The truthiness test passes for any non-empty string, so a non-numeric value
 * produced NaN with no guard. One of those three call sites writes the result
 * into SystemEmailConfig.smtpPort — an Int column — so a configuration typo
 * threw a Prisma error from inside getEmailConfig, the function whose job is
 * to PROVIDE the configuration, and the caller landed in the catch branch
 * that returns defaults.
 *
 * This was reachable rather than theoretical: .env.example shipped
 * `SMTP_PORT=\587\` — backslashes instead of quotes, escaping damage from an
 * earlier edit — across nineteen values. Anyone who copied the example to .env
 * got exactly that string. The example is repaired, but the guard belongs in
 * the code: the environment is not something this module controls.
 */

const findFirst = jest.fn();
const create = jest.fn();

jest.mock("../prisma", () => ({
  prisma: {
    systemEmailConfig: {
      findFirst: (...a: any[]) => findFirst(...a),
      create: (...a: any[]) => create(...a),
    },
  },
}));
jest.mock("../logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), security: jest.fn() },
}));
jest.mock("nodemailer", () => ({ createTransport: jest.fn() }));

const DEFAULT_PORT = 587;

describe("SMTP port resolution", () => {
  let getEmailConfig: any;
  let logger: any;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    delete process.env.SMTP_PORT;
    // No stored row, so the port comes from the environment via the create
    // path — the call site that used to write NaN into an Int column.
    findFirst.mockResolvedValue(null);
    create.mockImplementation(({ data }: any) => Promise.resolve({ id: "cfg", ...data }));
    getEmailConfig = require("../email").getEmailConfig;
    logger = require("../logger").logger;
  });

  it("uses SMTP_PORT when it is a valid port", async () => {
    process.env.SMTP_PORT = "2525";
    const cfg = await getEmailConfig();
    expect(cfg.smtpPort).toBe(2525);
  });

  it("falls back when SMTP_PORT is unset", async () => {
    const cfg = await getEmailConfig();
    expect(cfg.smtpPort).toBe(DEFAULT_PORT);
  });

  it.each([
    ["backslash-wrapped, as .env.example shipped it", "\\587\\"],
    ["quoted with literal quotes", '"587"'],
    ["not a number at all", "smtp"],
    ["empty after trimming", "   "],
    ["negative", "-1"],
    ["above the port range", "70000"],
    ["zero", "0"],
  ])("falls back when SMTP_PORT is %s", async (_label, value) => {
    process.env.SMTP_PORT = value;
    const cfg = await getEmailConfig();

    expect(Number.isFinite(cfg.smtpPort)).toBe(true);
    expect(cfg.smtpPort).toBe(DEFAULT_PORT);
  });

  it("never writes a non-integer port into the database", async () => {
    // The specific failure: create() receiving NaN for an Int column.
    process.env.SMTP_PORT = "\\587\\";
    await getEmailConfig();

    expect(create).toHaveBeenCalled();
    const written = create.mock.calls[0][0].data.smtpPort;
    expect(Number.isInteger(written)).toBe(true);
    expect(written).toBe(DEFAULT_PORT);
  });

  it("says so rather than silently substituting a default", async () => {
    // A port that is quietly ignored is a configuration change that appears to
    // have been applied. It has to be visible in the logs.
    process.env.SMTP_PORT = "not-a-port";
    await getEmailConfig();

    expect(logger.warn).toHaveBeenCalled();
    expect(logger.warn.mock.calls[0][0]).toBe("EMAIL_CONFIG");
    expect(logger.warn.mock.calls[0][1]).toContain("not-a-port");
  });

  it("prefers a stored port over the environment", async () => {
    // The stored SystemEmailConfig row is the operator's explicit choice.
    findFirst.mockResolvedValue({ id: "cfg", smtpPort: 465, smtpHost: "mail.example", senderEmail: "a@b.c" });
    process.env.SMTP_PORT = "2525";
    const cfg = await getEmailConfig();
    expect(cfg.smtpPort).toBe(465);
  });
});
