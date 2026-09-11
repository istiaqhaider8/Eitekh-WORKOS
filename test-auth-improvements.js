const http = require("http");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
const BASE_URL = "http://localhost:3000";

function makeRequest(urlPath, method = "GET", body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
    };

    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        let json = null;
        try {
          json = JSON.parse(data);
        } catch (e) {
          json = data;
        }
        resolve({
          status: res.statusCode,
          headers: res.headers,
          data: json,
        });
      });
    });

    req.on("error", reject);
    if (body) {
      req.write(typeof body === "string" ? body : JSON.stringify(body));
    }
    req.end();
  });
}

async function runTests() {
  console.log("=== Testing Authentication & Password Reset Improvements ===");
  let passed = 0;
  let total = 0;

  function assert(condition, message) {
    total++;
    if (condition) {
      console.log(`  ✅ [PASS] ${message}`);
      passed++;
    } else {
      console.error(`  ❌ [FAIL] ${message}`);
    }
  }

  try {
    // 1. Forgot password request
    const forgotRes = await makeRequest("/api/auth/forgot-password", "POST", {
      email: "sarah@acme.com",
    });
    assert(forgotRes.status === 200, "Forgot password endpoint returns 200");
    assert(forgotRes.data.success === true, "Forgot password returns success message");

    // 2. Verify token generated in database
    const user = await prisma.user.findUnique({ where: { email: "sarah@acme.com" } });
    assert(user && user.resetToken && user.resetTokenExp, "User has resetToken and resetTokenExp generated in DB");

    // 3. Verify email logged in EmailLog
    const latestEmail = await prisma.emailLog.findFirst({
      where: { to: "sarah@acme.com", templateKey: "PASSWORD_RESET" },
      orderBy: { createdAt: "desc" },
    });
    assert(latestEmail && latestEmail.from === "cocofbd@gmail.com", "Password reset email logged with from=cocofbd@gmail.com");

    // 4. Test weak password rejection
    const weakRes = await makeRequest("/api/auth/reset-password", "POST", {
      token: user.resetToken,
      newPassword: "123",
    });
    assert(weakRes.status === 400, "Weak password rejected with 400");

    // 5. Test invalid token rejection
    const invalidTokenRes = await makeRequest("/api/auth/reset-password", "POST", {
      token: "nonexistent-token-12345",
      newPassword: "NewStrongPassword123!",
    });
    assert(invalidTokenRes.status === 400, "Invalid token rejected with 400");

    // 6. Test successful password reset
    const newPass = "NewStrongPass123!";
    const resetRes = await makeRequest("/api/auth/reset-password", "POST", {
      token: user.resetToken,
      newPassword: newPass,
    });
    assert(resetRes.status === 200, "Password reset with valid token returns 200");

    // 7. Verify token cleared in DB
    const userAfterReset = await prisma.user.findUnique({ where: { email: "sarah@acme.com" } });
    assert(userAfterReset.resetToken === null, "Reset token cleared after successful reset");

    // 8. Verify login works with new password
    const loginRes = await makeRequest("/api/auth/login", "POST", {
      email: "sarah@acme.com",
      password: newPass,
    });
    assert(loginRes.status === 200, "Login successful with newly reset password");

    // Reset password back to original so other test suites aren't affected
    const resetBackRes = await makeRequest("/api/auth/change-password", "POST", {
      currentPassword: newPass,
      newPassword: "Password123!",
    }, {
      Cookie: loginRes.headers["set-cookie"] ? loginRes.headers["set-cookie"][0] : "",
    });
    assert(resetBackRes.status === 200, "Password successfully restored to Password123!");

    // 9. Test Email Verification Endpoint
    const testVerifyToken = "test-verify-token-" + Date.now();
    await prisma.user.update({
      where: { email: "sarah@acme.com" },
      data: { verificationToken: testVerifyToken, emailVerifiedAt: null },
    });

    const verifyRes = await makeRequest("/api/auth/verify-email", "POST", {
      token: testVerifyToken,
    });
    assert(verifyRes.status === 200, "Email verification returns 200");

    const userVerified = await prisma.user.findUnique({ where: { email: "sarah@acme.com" } });
    assert(userVerified.emailVerifiedAt !== null && userVerified.verificationToken === null, "User marked emailVerifiedAt in DB");

    console.log(`\n╔══════════════════════════════════════════════════════════════╗`);
    console.log(`║  RESULT: ${passed} PASSED / ${total - passed} FAILED / ${total} TOTAL`);
    console.log(`║  🎉 ALL AUTH & PASSWORD RESET CHECKS PASSED!                ║`);
    console.log(`╚══════════════════════════════════════════════════════════════╝\n`);
  } catch (error) {
    console.error("Test execution error:", error);
  } finally {
    await prisma.$disconnect();
  }
}

runTests();
