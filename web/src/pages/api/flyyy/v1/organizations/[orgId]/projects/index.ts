import { withFlyyyProvisioning } from "@/src/features/flyyy-provisioning/server/withFlyyyProvisioning";
import {
  CreateProjectBody,
  OrgPathQuery,
} from "@/src/features/flyyy-provisioning/server/schemas";
import {
  createProject,
  listProjects,
} from "@/src/features/flyyy-provisioning/server/service";

export default withFlyyyProvisioning({
  GET: async (req, res) => {
    const { orgId } = OrgPathQuery.parse(req.query);
    res.status(200).json({ data: await listProjects(orgId) });
  },
  POST: async (req, res) => {
    const { orgId } = OrgPathQuery.parse(req.query);
    const body = CreateProjectBody.parse(req.body);
    res.status(201).json(await createProject({ orgId, ...body }));
  },
});
