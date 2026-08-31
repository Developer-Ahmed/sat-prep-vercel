import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

const frontendApi = "unit-test.clerk.accounts.dev";
process.env.CLERK_PUBLISHABLE_KEY = `pk_test_${Buffer.from(`${frontendApi}$`).toString("base64")}`;
process.env.CLERK_SECRET_KEY = `sk_test_${"a".repeat(24)}`;
process.env.CLERK_AUTHORIZED_PARTIES = "https://sat.example.com";

const { createRequestAuthenticator, clerkPublicConfig, verifyClerkWebhook } = await import("../server/auth.js");

function request(sessionToken) {
  return {
    method: "GET",
    url: "/api/status",
    headers: {
      authorization: `Bearer ${sessionToken}`,
      host: "sat.example.com",
      origin: "https://sat.example.com"
    }
  };
}

test("Clerk publishable key resolves its frontend API", () => {
  assert.deepEqual(clerkPublicConfig(), {
    configured: true,
    publishableKey: process.env.CLERK_PUBLISHABLE_KEY,
    frontendApi,
    proxyUrl: ""
  });
});

test("Clerk exposes only the same-origin proxy path when production proxying is enabled", () => {
  process.env.CLERK_PROXY_URL = "https://sat.example.com/__clerk";
  try {
    assert.equal(clerkPublicConfig().proxyUrl, "/__clerk");
    assert.doesNotMatch(JSON.stringify(clerkPublicConfig()), /CLERK_SECRET_KEY|sk_live_/);
  } finally {
    delete process.env.CLERK_PROXY_URL;
  }
});

test("Clerk's request authenticator receives the complete request and exact authorized party", async () => {
  let capturedRequest;
  let capturedOptions;
  const authenticateRequest = createRequestAuthenticator({
    getClient: () => ({
      async authenticateRequest(webRequest, options) {
        capturedRequest = webRequest;
        capturedOptions = options;
        return {
          isAuthenticated: true,
          toAuth: () => ({
            userId: "user_test",
            sessionId: "sess_test",
            sessionClaims: { sub: "user_test", sid: "sess_test" }
          })
        };
      }
    })
  });
  const auth = await authenticateRequest(request("session-token"));
  assert.equal(auth.userId, "user_test");
  assert.equal(auth.sessionId, "sess_test");
  assert.equal(capturedRequest.headers.get("authorization"), "Bearer session-token");
  assert.deepEqual(capturedOptions, {
    acceptsToken: "session_token",
    authorizedParties: ["https://sat.example.com"]
  });
});

test("signed-out and failed Clerk request states are rejected", async () => {
  const signedOut = createRequestAuthenticator({
    getClient: () => ({ authenticateRequest: async () => ({ isAuthenticated: false }) })
  });
  const failed = createRequestAuthenticator({
    getClient: () => ({ authenticateRequest: async () => { throw new Error("invalid token"); } })
  });
  assert.equal(await signedOut(request("expired-token")), null);
  assert.equal(await failed(request("wrong-origin-token")), null);
});

test("Clerk webhooks require a current valid HMAC signature", async () => {
  const secretBytes = Buffer.from("unit-test-webhook-secret");
  process.env.CLERK_WEBHOOK_SIGNING_SECRET = `whsec_${secretBytes.toString("base64")}`;
  const body = JSON.stringify({ type: "user.deleted", data: { id: "user_test" } });
  const id = "msg_test";
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", secretBytes).update(`${id}.${timestamp}.${body}`).digest("base64");
  const req = {
    method: "POST",
    url: "/api/webhooks/clerk",
    headers: {
      host: "sat.example.com",
      "content-type": "application/json",
      "svix-id": id,
      "svix-timestamp": timestamp,
      "svix-signature": `v1,${signature}`
    }
  };

  const event = await verifyClerkWebhook(req, body);
  assert.equal(event.type, "user.deleted");
  assert.equal(event.data.id, "user_test");
  await assert.rejects(() => verifyClerkWebhook(req, `${body} `));
});
