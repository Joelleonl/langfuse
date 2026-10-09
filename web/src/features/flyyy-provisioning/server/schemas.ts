import * as z from "zod";

/** Langfuse ids are cuids; external ids are FLYYY UUIDs. Both are bounded to keep queries cheap. */
const Id = z.string().min(1).max(64);

const htmlTag = /<[^>]*>/;
const PlainText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((val) => !htmlTag.test(val), {
      message: "Text cannot contain HTML tags",
    });

export const OrgPathQuery = z.object({ orgId: Id });
export const ProjectPathQuery = OrgPathQuery.extend({ projectId: Id });
export const ApiKeyPathQuery = ProjectPathQuery.extend({ keyId: Id });

export const CreateOrganizationBody = z.object({
  externalId: Id,
  name: PlainText(200).pipe(z.string().min(1)),
});

export const CreateProjectBody = z.object({
  externalId: Id,
  name: PlainText(200).pipe(z.string().min(1)),
});

export const CreateApiKeyBody = z.object({
  note: PlainText(200).optional(),
});
