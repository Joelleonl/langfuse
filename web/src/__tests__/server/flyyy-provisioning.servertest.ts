import { randomUUID } from "crypto";
import { type NextApiRequest, type NextApiResponse } from "next";
import { prisma } from "@langfuse/shared/src/db";
import { env } from "@/src/env.mjs";
import { ApiAuthService } from "@/src/features/public-api/server/apiAuth";
import { isFlyyyProvisioningAuthorized } from "@/src/features/flyyy-provisioning/server/withFlyyyProvisioning";
import organizationsHandler from "@/src/pages/api/flyyy/v1/organizations";
import projectsHandler from "@/src/pages/api/flyyy/v1/organizations/[orgId]/projects";
import projectHandler from "@/src/pages/api/flyyy/v1/organizations/[orgId]/projects/[projectId]";
import apiKeysHandler from "@/src/pages/api/flyyy/v1/organizations/[orgId]/projects/[projectId]/api-keys";
import apiKeyHandler from "@/src/pages/api/flyyy/v1/organizations/[orgId]/projects/[projectId]/api-keys/[keyId]";

const SECRET = "flyyy-test-provisioning-secret-0123456789abcdef";
const AUTH = `Bearer ${SECRET}`;

type MockResult = { status: number; body: any };

async function call(
  handler: (req: NextApiRequest, res: NextApiResponse) => Promise<unknown>,
  p: {
    method: string;
    query?: Record<string, string>;
    body?: unknown;
    auth?: string | null;
  },
): Promise<MockResult> {
  const result: MockResult = { status: 0, body: undefined };
  const res = {
    status(code: number) {
      result.status = code;
      return res;
    },
    json(body: unknown) {
      result.body = body;
      return res;
    },
    end() {
      return res;
    },
  } as unknown as NextApiResponse;
  const req = {
    method: p.method,
    query: p.query ?? {},
    body: p.body,
    url: "/api/flyyy/v1/test",
    headers: p.auth === null ? {} : { authorization: p.auth ?? AUTH },
  } as unknown as NextApiRequest;
  await handler(req, res);
  return result;
}

async function createFlyyyOrg(name = `org-${randomUUID()}`) {
  const res = await call(organizationsHandler, {
    method: "POST",
    body: { externalId: randomUUID(), name },
  });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

async function createFlyyyProject(orgId: string) {
  const res = await call(projectsHandler, {
    method: "POST",
    query: { orgId },
    body: { externalId: randomUUID(), name: `agent-${randomUUID()}` },
  });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

describe("FLYYY provisioning API", () => {
  const originalSecret = env.FLYYY_PROVISIONING_SECRET;

  beforeAll(() => {
    (env as any).FLYYY_PROVISIONING_SECRET = SECRET;
  });

  afterAll(() => {
    (env as any).FLYYY_PROVISIONING_SECRET = originalSecret;
  });

  describe("auth", () => {
    it("compares the bearer secret exactly", () => {
      expect(isFlyyyProvisioningAuthorized(AUTH, SECRET)).toBe(true);
      expect(isFlyyyProvisioningAuthorized(`Bearer ${SECRET}x`, SECRET)).toBe(
        false,
      );
      expect(isFlyyyProvisioningAuthorized(undefined, SECRET)).toBe(false);
      expect(isFlyyyProvisioningAuthorized(`Basic ${SECRET}`, SECRET)).toBe(
        false,
      );
    });

    it("rejects missing or wrong credentials with 401", async () => {
      const missing = await call(organizationsHandler, {
        method: "POST",
        body: { externalId: randomUUID(), name: "x" },
        auth: null,
      });
      expect(missing.status).toBe(401);

      const wrong = await call(organizationsHandler, {
        method: "POST",
        body: { externalId: randomUUID(), name: "x" },
        auth: "Bearer wrong",
      });
      expect(wrong.status).toBe(401);
    });

    it("is disabled (404) when the secret is not configured", async () => {
      (env as any).FLYYY_PROVISIONING_SECRET = undefined;
      try {
        const res = await call(organizationsHandler, {
          method: "POST",
          body: { externalId: randomUUID(), name: "x" },
        });
        expect(res.status).toBe(404);
      } finally {
        (env as any).FLYYY_PROVISIONING_SECRET = SECRET;
      }
    });
  });

  describe("organizations", () => {
    it("creates an org once per externalId (idempotent)", async () => {
      const externalId = randomUUID();
      const first = await call(organizationsHandler, {
        method: "POST",
        body: { externalId, name: "Acme" },
      });
      const second = await call(organizationsHandler, {
        method: "POST",
        body: { externalId, name: "Acme renamed" },
      });
      expect(first.status).toBe(201);
      expect(second.status).toBe(200);
      expect(second.body.id).toBe(first.body.id);
    });

    it("refuses orgs that were not created through FLYYY", async () => {
      const foreign = await prisma.organization.create({
        data: { name: `foreign-${randomUUID()}` },
      });
      const res = await call(projectsHandler, {
        method: "GET",
        query: { orgId: foreign.id },
      });
      expect(res.status).toBe(404);
    });
  });

  describe("projects", () => {
    it("creates, lists and rejects duplicate names", async () => {
      const orgId = await createFlyyyOrg();
      const name = `agent-${randomUUID()}`;
      const created = await call(projectsHandler, {
        method: "POST",
        query: { orgId },
        body: { externalId: randomUUID(), name },
      });
      expect(created.status).toBe(201);

      const dup = await call(projectsHandler, {
        method: "POST",
        query: { orgId },
        body: { externalId: randomUUID(), name },
      });
      expect(dup.status).toBe(409);

      const list = await call(projectsHandler, {
        method: "GET",
        query: { orgId },
      });
      expect(list.body.data.map((p: { id: string }) => p.id)).toEqual([
        created.body.id,
      ]);
    });

    it("does not expose a project through another org's path", async () => {
      const orgA = await createFlyyyOrg();
      const orgB = await createFlyyyOrg();
      const projectA = await createFlyyyProject(orgA);

      const viaB = await call(projectHandler, {
        method: "GET",
        query: { orgId: orgB, projectId: projectA },
      });
      expect(viaB.status).toBe(404);

      const keyViaB = await call(apiKeysHandler, {
        method: "POST",
        query: { orgId: orgB, projectId: projectA },
        body: {},
      });
      expect(keyViaB.status).toBe(404);

      const deleteViaB = await call(projectHandler, {
        method: "DELETE",
        query: { orgId: orgB, projectId: projectA },
      });
      expect(deleteViaB.status).toBe(404);
    });
  });

  describe("api keys", () => {
    it("issues a working project key, lists it without the secret, and revokes it", async () => {
      const orgId = await createFlyyyOrg();
      const projectId = await createFlyyyProject(orgId);

      const created = await call(apiKeysHandler, {
        method: "POST",
        query: { orgId, projectId },
        body: { note: "agent" },
      });
      expect(created.status).toBe(201);
      expect(created.body.publicKey).toMatch(/^pk-lf-/);
      expect(created.body.secretKey).toMatch(/^sk-lf-/);

      const basic = `Basic ${Buffer.from(
        `${created.body.publicKey}:${created.body.secretKey}`,
      ).toString("base64")}`;
      const authService = new ApiAuthService(prisma, null);
      const verified = await authService.verifyAuthHeaderAndReturnScope(basic);
      expect(verified.validKey).toBe(true);
      if (verified.validKey) {
        expect(verified.scope.projectId).toBe(projectId);
        expect(verified.scope.accessLevel).toBe("project");
      }

      const list = await call(apiKeysHandler, {
        method: "GET",
        query: { orgId, projectId },
      });
      expect(list.body.data).toHaveLength(1);
      expect(list.body.data[0]).not.toHaveProperty("secretKey");
      expect(list.body.data[0]).not.toHaveProperty("hashedSecretKey");

      const revoked = await call(apiKeyHandler, {
        method: "DELETE",
        query: { orgId, projectId, keyId: created.body.id },
      });
      expect(revoked.status).toBe(204);

      const after = await authService.verifyAuthHeaderAndReturnScope(basic);
      expect(after.validKey).toBe(false);
    });

    it("deleting a project removes its keys and soft-deletes it", async () => {
      const orgId = await createFlyyyOrg();
      const projectId = await createFlyyyProject(orgId);
      await call(apiKeysHandler, {
        method: "POST",
        query: { orgId, projectId },
        body: {},
      });

      const deleted = await call(projectHandler, {
        method: "DELETE",
        query: { orgId, projectId },
      });
      expect(deleted.status).toBe(204);

      const project = await prisma.project.findUnique({
        where: { id: projectId },
      });
      expect(project?.deletedAt).not.toBeNull();
      expect(await prisma.apiKey.count({ where: { projectId } })).toBe(0);
    });
  });
});
