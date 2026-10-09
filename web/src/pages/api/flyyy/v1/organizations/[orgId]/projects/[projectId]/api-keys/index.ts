import { withFlyyyProvisioning } from "@/src/features/flyyy-provisioning/server/withFlyyyProvisioning";
import {
  CreateApiKeyBody,
  ProjectPathQuery,
} from "@/src/features/flyyy-provisioning/server/schemas";
import {
  createApiKey,
  listApiKeys,
} from "@/src/features/flyyy-provisioning/server/service";

export default withFlyyyProvisioning({
  // Never returns secrets; only masked display values.
  GET: async (req, res) => {
    const { orgId, projectId } = ProjectPathQuery.parse(req.query);
    res.status(200).json({ data: await listApiKeys(orgId, projectId) });
  },
  // Returns the plaintext secretKey once. Callers must not log the response.
  POST: async (req, res) => {
    const { orgId, projectId } = ProjectPathQuery.parse(req.query);
    const { note } = CreateApiKeyBody.parse(req.body ?? {});
    res.status(201).json(await createApiKey({ orgId, projectId, note }));
  },
});
