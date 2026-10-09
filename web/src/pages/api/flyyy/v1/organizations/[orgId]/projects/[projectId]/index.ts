import { withFlyyyProvisioning } from "@/src/features/flyyy-provisioning/server/withFlyyyProvisioning";
import { ProjectPathQuery } from "@/src/features/flyyy-provisioning/server/schemas";
import {
  deleteProject,
  getProject,
} from "@/src/features/flyyy-provisioning/server/service";

export default withFlyyyProvisioning({
  GET: async (req, res) => {
    const { orgId, projectId } = ProjectPathQuery.parse(req.query);
    res.status(200).json(await getProject(orgId, projectId));
  },
  DELETE: async (req, res) => {
    const { orgId, projectId } = ProjectPathQuery.parse(req.query);
    await deleteProject(orgId, projectId);
    res.status(204).end();
  },
});
