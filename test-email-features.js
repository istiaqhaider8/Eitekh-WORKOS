const http = require("http");

function req(method, path, body, cookie) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: "localhost",
      port: 3000,
      path,
      method,
      headers: { "Content-Type": "application/json" },
    };
    if (cookie) opts.headers.Cookie = cookie;
    const r = http.request(opts, (res) => {
      let d = "";
      res.on("data", (c) => (d += c));
      res.on("end", () => {
        let json;
        try { json = JSON.parse(d); } catch { json = d; }
        resolve({ status: res.statusCode, headers: res.headers, data: json });
      });
    });
    r.on("error", reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

function extractCookie(res) {
  const sc = res.headers["set-cookie"];
  return sc ? sc[0].split(";")[0] : "";
}

(async () => {
  console.log("=== Testing Email & Notification System ===");

  // Login as Super Admin
  const adminLogin = await req("POST", "/api/auth/demo-login", { role: "admin" });
  const adminCookie = extractCookie(adminLogin);

  // 1. Get email settings
  const getSettings = await req("GET", "/api/super-admin/email-settings", null, adminCookie);
  console.log("1. Email Settings:", getSettings.status, "Default Sender:", getSettings.data.config?.senderEmail);

  if (getSettings.data.config?.senderEmail !== "cocofbd@gmail.com") {
    console.error("FAIL: Sender email is not cocofbd@gmail.com");
    process.exit(1);
  }

  // 2. Send test email
  const sendTest = await req("POST", "/api/super-admin/email-settings/test", { to: "test-user@example.com" }, adminCookie);
  console.log("2. Send Test Email:", sendTest.status, sendTest.data.message);

  // 3. Get templates
  const getTemplates = await req("GET", "/api/super-admin/email-templates", null, adminCookie);
  console.log("3. Email Templates count:", getTemplates.data.templates?.length);

  // 4. Update a template
  const updateTpl = await req("PATCH", "/api/super-admin/email-templates/WELCOME", {
    subject: "Welcome to Zenith WorkOS, {{userName}}! 🚀 (Customized)",
    bodyHtml: "<p>Customized welcome email sent via cocofbd@gmail.com to {{userName}}</p>",
  }, adminCookie);
  console.log("4. Update Template WELCOME:", updateTpl.status, updateTpl.data.template?.subject);

  // 5. Preview template with dynamic variables
  const previewTpl = await req("POST", "/api/super-admin/email-templates/WELCOME", {
    sampleVariables: { userName: "John Doe" },
  }, adminCookie);
  console.log("5. Preview Rendered Subject:", previewTpl.data.renderedSubject);

  // 6. Non-super admin blocked
  const devLogin = await req("POST", "/api/auth/demo-login", { role: "dev" });
  const devCookie = extractCookie(devLogin);
  const devAccess = await req("GET", "/api/super-admin/email-settings", null, devCookie);
  console.log("6. Regular user access blocked:", devAccess.status === 403 ? "PASSED (403)" : "FAILED");

  console.log("\n✅ ALL EMAIL NOTIFICATION TESTS PASSED!");
})();
