/**
 * FLYYY provisioning service.
 *
 * Lets the FLYYY control plane manage one Langfuse organization per FLYYY
 * organization and one Langfuse project (with project API keys) per FLYYY agent.
 *
 * Built only on MIT-licensed Langfuse core (Prisma models, createAndAddApiKeysToDb,
 * API key cache invalidation, ProjectDeleteQueue). It must not import from any
 * `ee/` directory.
 */
import { randomUUID } from "crypto";
import { prisma } from "@langfuse/shared/src/db";
import {
  LangfuseConflictError,
  LangfuseNotFoundError,
  InternalServerError,
} from "@langfuse/shared";
import {
  redis,
  invalidateCachedOrgApiKeys,
  ProjectDeleteQueue,
  QueueJobs,
} from "@langfuse/shared/src/server";
import { createAndAddApiKeysToDb } from "@langfuse/shared/src/server/auth/apiKeys";
import { ApiAuthService } from "@/src/features/public-api/server/apiAuth";

const FLYYY_ORG_METADATA_KEY = "flyyyOrgId";
const FLYYY_PROJECT_METADATA_KEY = "flyyyProjectId";

/** ensureOrganization returns the Langfuse org linked to a FLYYY org, creating it on first use. */
export async function ensureOrganization(p: {
  externalId: string;
  name: string;
}) {
  const existing = await prisma.organization.findFirst({
    where: {
      metadata: { path: [FLYYY_ORG_METADATA_KEY], equals: p.externalId },
    },
    select: { id: true, name: true },
  });
  if (existing) return { ...existing, created: false };

  const org = await prisma.organization.create({
    data: {
      name: p.name,
      metadata: { [FLYYY_ORG_METADATA_KEY]: p.externalId },
    },
    select: { id: true, name: true },
  });
  return { ...org, created: true };
}

/** getOrganizationOrThrow guards every org-scoped route: unknown orgs and orgs not created via FLYYY are 404. */
async function getOrganizationOrThrow(orgId: string) {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { id: true, metadata: true },
  });
  const metadata = (org?.metadata ?? {}) as Record<string, unknown>;
  if (!org || typeof metadata[FLYYY_ORG_METADATA_KEY] !== "string") {
    throw new LangfuseNotFoundError("Organization not found");
  }
  return org;
}

/** getProjectOrThrow enforces that the project belongs to the org in the path. */
async function getProjectOrThrow(orgId: string, projectId: string) {
  await getOrganizationOrThrow(orgId);
  const project = await prisma.project.findFirst({
    where: { id: projectId, orgId, deletedAt: null },
    select: { id: true, name: true, hasTraces: true, createdAt: true },
  });
  if (!project) throw new LangfuseNotFoundError("Project not found");
  return project;
}

export async function listProjects(orgId: string) {
  await getOrganizationOrThrow(orgId);
  return prisma.project.findMany({
    where: { orgId, deletedAt: null },
    select: { id: true, name: true, hasTraces: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
}

export async function getProject(orgId: string, projectId: string) {
  return getProjectOrThrow(orgId, projectId);
}

export async function createProject(p: {
  orgId: string;
  externalId: string;
  name: string;
}) {
  await getOrganizationOrThrow(p.orgId);

  const sameName = await prisma.project.findFirst({
    where: { orgId: p.orgId, name: p.name, deletedAt: null },
    select: { id: true },
  });
  if (sameName) {
    throw new LangfuseConflictError(
      "A project with this name already exists in this organization",
    );
  }

  const project = await prisma.project.create({
    data: {
      orgId: p.orgId,
      name: p.name,
      metadata: { [FLYYY_PROJECT_METADATA_KEY]: p.externalId },
    },
    select: { id: true, name: true, hasTraces: true, createdAt: true },
  });

  // Org-scoped keys cache the org's project ids; refresh them.
  await invalidateCachedOrgApiKeys(p.orgId);
  return project;
}

/**
 * deleteProject mirrors the core project deletion sequence: evict cached keys,
 * delete keys, soft-delete the project, then queue the async data deletion.
 */
export async function deleteProject(orgId: string, projectId: string) {
  await getProjectOrThrow(orgId, projectId);

  const projectDeleteQueue = ProjectDeleteQueue.getInstance();
  if (!projectDeleteQueue) {
    throw new InternalServerError("ProjectDeleteQueue is not available");
  }

  await new ApiAuthService(prisma, redis).invalidateCachedProjectApiKeys(
    projectId,
  );
  await prisma.apiKey.deleteMany({
    where: { projectId, scope: "PROJECT" },
  });
  await prisma.project.update({
    where: { id: projectId, orgId },
    data: { deletedAt: new Date() },
  });
  await invalidateCachedOrgApiKeys(orgId);

  await projectDeleteQueue.add(QueueJobs.ProjectDelete, {
    timestamp: new Date(),
    id: randomUUID(),
    payload: { projectId, orgId },
    name: QueueJobs.ProjectDelete,
  });
}

export async function listApiKeys(orgId: string, projectId: string) {
  await getProjectOrThrow(orgId, projectId);
  return prisma.apiKey.findMany({
    where: { projectId, scope: "PROJECT", isInAppAgentKey: false },
    select: {
      id: true,
      publicKey: true,
      displaySecretKey: true,
      note: true,
      createdAt: true,
      lastUsedAt: true,
    },
    orderBy: { createdAt: "asc" },
  });
}

/** createApiKey returns the plaintext secret exactly once; Langfuse stores only hashes. */
export async function createApiKey(p: {
  orgId: string;
  projectId: string;
  note?: string;
}) {
  await getProjectOrThrow(p.orgId, p.projectId);
  const key = await createAndAddApiKeysToDb({
    prisma,
    entityId: p.projectId,
    scope: "PROJECT",
    note: p.note,
  });
  return {
    id: key.id,
    publicKey: key.publicKey,
    secretKey: key.secretKey,
    displaySecretKey: key.displaySecretKey,
    note: key.note,
    createdAt: key.createdAt,
  };
}

/** deleteApiKey removes the key row and evicts it from the Redis auth cache. */
export async function deleteApiKey(p: {
  orgId: string;
  projectId: string;
  keyId: string;
}) {
  await getProjectOrThrow(p.orgId, p.projectId);
  const key = await prisma.apiKey.findFirst({
    where: {
      id: p.keyId,
      projectId: p.projectId,
      scope: "PROJECT",
      isInAppAgentKey: false,
    },
    select: { id: true },
  });
  if (!key) throw new LangfuseNotFoundError("API key not found");

  await new ApiAuthService(prisma, redis).deleteApiKey(
    p.keyId,
    p.projectId,
    "PROJECT",
  );
}
