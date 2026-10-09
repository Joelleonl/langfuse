import { withFlyyyProvisioning } from "@/src/features/flyyy-provisioning/server/withFlyyyProvisioning";
import { ApiKeyPathQuery } from "@/src/features/flyyy-provisioning/server/schemas";
import { deleteApiKey } from "@/src/features/flyyy-provisioning/server/service";

export default withFlyyyProvisioning({
  // Deleting is the only reliable revocation: ApiKey.expiresAt is not enforced at auth time.
  DELETE: async (req, res) => {
    const { orgId, projectId, keyId } = ApiKeyPathQuery.parse(req.query);
    await deleteApiKey({ orgId, projectId, keyId });
    res.status(204).end();
  },
});
