import crypto from "node:crypto";
import { type NextApiRequest, type NextApiResponse } from "next";
import { isBaseError } from "@langfuse/shared";
import { logger, traceException } from "@langfuse/shared/src/server";
import { env } from "@/src/env.mjs";
import { isPrismaException } from "@/src/utils/exceptions";

type Method = "GET" | "POST" | "DELETE";
type Handler = (req: NextApiRequest, res: NextApiResponse) => Promise<void>;

/**
 * isFlyyyProvisioningAuthorized checks `Authorization: Bearer <FLYYY_PROVISIONING_SECRET>`
 * with a constant-time comparison. The secret is only ever held by the FLYYY backend.
 */
export function isFlyyyProvisioningAuthorized(
  authHeader: string | undefined,
  secret: string,
): boolean {
  if (!authHeader?.startsWith("Bearer ")) return false;
  const provided = Buffer.from(authHeader.slice("Bearer ".length));
  const expected = Buffer.from(secret);
  if (provided.length !== expected.length) return false;
  return crypto.timingSafeEqual(provided, expected);
}

/**
 * withFlyyyProvisioning wraps a server-to-server route used by the FLYYY control plane.
 * - Disabled (404) unless FLYYY_PROVISIONING_SECRET is configured.
 * - No CORS: browsers must never call these routes.
 * - Request/response bodies are never logged (they may carry API secret keys).
 */
export function withFlyyyProvisioning(
  handlers: Partial<Record<Method, Handler>>,
) {
  return async (req: NextApiRequest, res: NextApiResponse) => {
    const secret = env.FLYYY_PROVISIONING_SECRET;
    if (!secret) {
      return res.status(404).json({ message: "Not found" });
    }
    if (!isFlyyyProvisioningAuthorized(req.headers.authorization, secret)) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const handler = handlers[req.method as Method];
    if (!handler) {
      return res.status(405).json({ message: "Method not allowed" });
    }

    try {
      return await handler(req, res);
    } catch (error) {
      if (isBaseError(error)) {
        if (error.httpCode >= 500) {
          logger.error("FLYYY provisioning request failed", {
            route: req.url,
            message: error.message,
          });
        }
        return res.status(error.httpCode).json({ message: error.message });
      }
      if (
        error &&
        typeof error === "object" &&
        "name" in error &&
        error.name === "ZodError"
      ) {
        return res.status(400).json({
          message: "Invalid request data",
          error: (error as { issues?: unknown }).issues,
        });
      }
      traceException(error);
      logger.error("FLYYY provisioning request failed", {
        route: req.url,
        prisma: isPrismaException(error),
        message: error instanceof Error ? error.message : "unknown",
      });
      return res.status(500).json({ message: "Internal server error" });
    }
  };
}
