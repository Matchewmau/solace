// Test helper: pre-authed supertest wrapper for the shared login.
// Every /api route except POST /api/auth/login requires the x-solace-auth
// header matching the server password, so tests build requests via
// `authed(app)` instead of bare `request(app)`.
import request from "supertest";

export const TEST_AUTH_PASSWORD = "solace123";

export function authed(app, password = TEST_AUTH_PASSWORD) {
  const withAuth = (req) => req.set("x-solace-auth", password);
  return {
    get: (url) => withAuth(request(app).get(url)),
    post: (url) => withAuth(request(app).post(url)),
    patch: (url) => withAuth(request(app).patch(url)),
    put: (url) => withAuth(request(app).put(url)),
    delete: (url) => withAuth(request(app).delete(url)),
  };
}
