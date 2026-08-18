import assert from "node:assert/strict";
import test from "node:test";
import type { ProjectKnowledgeModelRepository } from "../knowledge/projectKnowledgeModelRepository.js";
import { ProjectDerivedStateInvalidationService } from "./projectDerivedStateInvalidationService.js";

test("invalidateProject marks the knowledge model stale", async () => {
  const calls: string[] = [];

  const projectKnowledgeModelRepository = {
    markStale: async (projectId: string) => {
      calls.push(`markStale:${projectId}`);
      return null;
    },
  } as unknown as ProjectKnowledgeModelRepository;

  const service = new ProjectDerivedStateInvalidationService(
    projectKnowledgeModelRepository,
  );

  await service.invalidateProject("project-1", null);

  assert.deepEqual(calls, ["markStale:project-1"]);
});
