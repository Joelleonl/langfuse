import { withFlyyyProvisioning } from "@/src/features/flyyy-provisioning/server/withFlyyyProvisioning";
import { CreateOrganizationBody } from "@/src/features/flyyy-provisioning/server/schemas";
import { ensureOrganization } from "@/src/features/flyyy-provisioning/server/service";

export default withFlyyyProvisioning({
  // Idempotent: returns the existing org for the same FLYYY externalId.
  POST: async (req, res) => {
    const body = CreateOrganizationBody.parse(req.body);
    const org = await ensureOrganization(body);
    res
      .status(org.created ? 201 : 200)
      .json({ id: org.id, name: org.name, created: org.created });
  },
});
