import assert from "node:assert/strict";
import test from "node:test";
import { AppError } from "../../shared/errors/appError.js";
import type { AuthorizationService } from "../../shared/auth/authorizationService.js";
import {
  ProjectOutcomeStatementService,
  ensureOutcomeStatementsForIntendedChanges,
  normalizeOutcomeStatementValue,
  syncOutcomeStatementsForIntendedChanges,
} from "./projectOutcomeStatementService.js";
import type { ProjectOutcomeStatementRepository } from "./projectOutcomeStatementRepository.js";
import type { ProjectOutcomeStatementPersistenceRecord } from "./projectOutcomeStatementPersistence.js";
import type { ProcessingResourceCleanupService } from "../processing/processingResourceCleanupService.js";
import type { ProjectDerivedStateInvalidationService } from "../project/projectDerivedStateInvalidationService.js";

const NOW = new Date("2026-08-18T10:00:00.000Z");

type CleanupServiceStub = Pick<
  ProcessingResourceCleanupService,
  "resetOutcomeEvidencePairingByProjectId" | "deleteByOutcomeStatementIds"
>;

type InvalidationServiceStub = Pick<
  ProjectDerivedStateInvalidationService,
  "invalidateProject"
>;

function createRepository() {
  const records = new Map<string, ProjectOutcomeStatementPersistenceRecord>();
  let nextId = 1;

  const repository: ProjectOutcomeStatementRepository = {
    async create(input) {
      const id = `outcome-${nextId}`;
      nextId += 1;
      const record: ProjectOutcomeStatementPersistenceRecord = {
        id,
        projectId: input.projectId,
        organizationId: input.organizationId,
        term: input.term,
        statement: input.statement,
        createdAt: NOW,
        updatedAt: NOW,
      };
      records.set(id, record);
      return record;
    },
    async findById(outcomeStatementId) {
      return records.get(outcomeStatementId) ?? null;
    },
    async listByProjectId(projectId) {
      return [...records.values()].filter(
        (record) => record.projectId === projectId,
      );
    },
    async update(outcomeStatementId, input) {
      const existing = records.get(outcomeStatementId);
      if (!existing) {
        return null;
      }
      const updated = { ...existing, ...input, updatedAt: NOW };
      records.set(outcomeStatementId, updated);
      return updated;
    },
    async deleteById(outcomeStatementId) {
      return records.delete(outcomeStatementId);
    },
    async deleteByProjectId(projectId) {
      let deletedCount = 0;
      for (const [id, record] of records) {
        if (record.projectId === projectId) {
          records.delete(id);
          deletedCount += 1;
        }
      }
      return deletedCount;
    },
  };

  return repository;
}

function createFixture(options?: {
  canEdit?: boolean;
  repository?: ProjectOutcomeStatementRepository;
  intendedChanges?: string[];
  cleanupService?: CleanupServiceStub;
  invalidationService?: InvalidationServiceStub;
}) {
  const authorizationService = {
    canViewProject: async (_userId: string, projectId: string) => ({
      project: {
        id: projectId,
        organizationId: "org-1",
        ownerId: "user-1",
        name: "Project",
        projectGoal: null,
        initialSituation: null,
        startMonth: "2026-01",
        endMonth: "2026-12",
        fundingProgram: null,
        fundingOrganization: null,
        targetGroups: [],
        overarchingTargetGroup: null,
        intendedChanges: options?.intendedChanges ?? [],
        areaOfOperation: null,
        partnerships: null,
        sdgs: [],
        impactModel: {
          inputs: null,
          activities: null,
          outputs: null,
          impact: null,
          outcomes: null,
        },
        successIndicators: null,
        status: "active",
        archivedFromStatus: null,
        createdAt: NOW,
        updatedAt: NOW,
      },
    }),
    canEditProject: async (_userId: string, projectId: string) => {
      if (options?.canEdit === false) {
        throw new AppError(
          "You do not have permission to edit this project.",
          403,
          "project_edit_denied",
        );
      }
      return { project: { id: projectId, organizationId: "org-1" } };
    },
  } as unknown as AuthorizationService;

  return {
    service: new ProjectOutcomeStatementService(
      authorizationService,
      options?.repository ?? createRepository(),
      options?.cleanupService as
        | ProcessingResourceCleanupService
        | undefined,
      options?.invalidationService as
        | ProjectDerivedStateInvalidationService
        | undefined,
    ),
  };
}

test("create persists a statement scoped to the project and organization from authorization", async () => {
  const { service } = createFixture();

  const statement = await service.create("user-1", "project-1", {
    term: "short",
    statement: "Jugendliche gewinnen mehr berufliche Klarheit.",
  });

  assert.equal(statement.projectId, "project-1");
  assert.equal(statement.organizationId, "org-1");
  assert.equal(statement.term, "short");
  assert.equal(
    statement.statement,
    "Jugendliche gewinnen mehr berufliche Klarheit.",
  );
});

test("listForProject only requires view access, not edit access", async () => {
  const repository = createRepository();
  const editorService = createFixture({ repository }).service;
  const viewerService = createFixture({ repository, canEdit: false }).service;

  await editorService.create("user-1", "project-1", {
    term: "long",
    statement: "Langfristige Wirkung.",
  });

  const statements = await viewerService.listForProject("user-2", "project-1");
  assert.equal(statements.length, 1);
  assert.equal(statements[0]?.statement, "Langfristige Wirkung.");
});

test("listForProject auto-seeds missing outcome statements from the project's intended changes", async () => {
  const { service } = createFixture({
    intendedChanges: [
      "Jugendliche gewinnen mehr berufliche Klarheit.",
      "Jugendliche setzen konkrete Karriereschritte um.",
    ],
  });

  const statements = await service.listForProject("user-1", "project-1");

  assert.equal(statements.length, 2);
  assert.deepEqual(
    statements.map((statement) => ({
      term: statement.term,
      statement: statement.statement,
    })),
    [
      {
        term: "long",
        statement: "Jugendliche gewinnen mehr berufliche Klarheit.",
      },
      {
        term: "long",
        statement: "Jugendliche setzen konkrete Karriereschritte um.",
      },
    ],
  );
});

test("listForProject does not duplicate a manually existing statement when auto-seeding intended changes", async () => {
  const repository = createRepository();
  const editorService = createFixture({ repository }).service;
  const viewerService = createFixture({
    repository,
    intendedChanges: [
      "Jugendliche gewinnen mehr berufliche Klarheit.",
      "Jugendliche setzen konkrete Karriereschritte um.",
    ],
  }).service;

  await editorService.create("user-1", "project-1", {
    term: "long",
    statement: "Jugendliche gewinnen mehr berufliche Klarheit.",
  });

  const statements = await viewerService.listForProject("user-1", "project-1");

  assert.equal(statements.length, 2);
  assert.equal(
    statements.filter(
      (statement) =>
        statement.statement ===
        "Jugendliche gewinnen mehr berufliche Klarheit.",
    ).length,
    1,
  );
});

test("update rejects a statement that belongs to a different project", async () => {
  const { service } = createFixture();
  const created = await service.create("user-1", "project-1", {
    term: "short",
    statement: "Original.",
  });

  await assert.rejects(
    () =>
      service.update("user-1", "project-2", created.id, {
        statement: "Hijacked.",
      }),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, "project_outcome_statement_not_found");
      assert.equal(error.statusCode, 404);
      return true;
    },
  );
});

test("delete removes the statement and returns its last known value", async () => {
  const { service } = createFixture();
  const created = await service.create("user-1", "project-1", {
    term: "short",
    statement: "Wird geloescht.",
  });

  const deleted = await service.delete("user-1", "project-1", created.id);
  assert.equal(deleted.id, created.id);

  const remaining = await service.listForProject("user-1", "project-1");
  assert.deepEqual(remaining, []);
});

test("delete removes linked Wirkungsaussage state and invalidates project-derived state", async () => {
  const calls: string[] = [];
  const { service } = createFixture({
    cleanupService: {
      resetOutcomeEvidencePairingByProjectId: async () => undefined,
      deleteByOutcomeStatementIds: async (
        projectId: string,
        outcomeStatementIds: string[],
      ) => {
        calls.push(`cleanup:${projectId}:${outcomeStatementIds.join(",")}`);
      },
    },
    invalidationService: {
      invalidateProject: async (projectId: string) => {
        calls.push(`invalidate:${projectId}`);
      },
    },
  });
  const created = await service.create("user-1", "project-1", {
    term: "short",
    statement: "Wird geloescht.",
  });
  calls.length = 0;

  await service.delete("user-1", "project-1", created.id);

  assert.deepEqual(calls, [
    `cleanup:project-1:${created.id}`,
    "invalidate:project-1",
  ]);
});

test("create fails when the caller cannot edit the project", async () => {
  const { service } = createFixture({ canEdit: false });

  await assert.rejects(
    () =>
      service.create("user-1", "project-1", {
        term: "short",
        statement: "Should not be created.",
      }),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, "project_edit_denied");
      return true;
    },
  );
});

test("normalizeOutcomeStatementValue folds case using locale rules, not a plain toLowerCase", () => {
  // Regression test: ProjectService and ProjectOutcomeStatementService used
  // to have two independent implementations of "is this the same outcome
  // statement" with different case-folding (toLocaleLowerCase vs
  // toLowerCase) — which of the two ran first could determine what counted
  // as a duplicate. Both now share this one function.
  assert.equal(
    normalizeOutcomeStatementValue("  Jugendliche gewinnen Klarheit.  "),
    "jugendliche gewinnen klarheit.",
  );
});

test("ensureOutcomeStatementsForIntendedChanges (shared by both call sites) does not duplicate an existing statement", async () => {
  const repository = createRepository();
  await repository.create(
    {
      projectId: "project-1",
      organizationId: "org-1",
      term: "long",
      statement: "Jugendliche gewinnen mehr berufliche Klarheit.",
    },
    null,
  );

  const records = await ensureOutcomeStatementsForIntendedChanges(
    repository,
    {
      projectId: "project-1",
      organizationId: "org-1",
      intendedChanges: [
        "Jugendliche gewinnen mehr berufliche Klarheit.",
        "Jugendliche setzen konkrete Karriereschritte um.",
      ],
    },
    null,
  );

  assert.equal(records.length, 2);
  assert.equal(
    records.filter(
      (record) =>
        record.statement === "Jugendliche gewinnen mehr berufliche Klarheit.",
    ).length,
    1,
  );
});

test("syncOutcomeStatementsForIntendedChanges removes statements for removed intended changes while preserving unrelated statements", async () => {
  const repository = createRepository();
  const removed = await repository.create(
    {
      projectId: "project-1",
      organizationId: "org-1",
      term: "long",
      statement: "Jugendliche gewinnen mehr berufliche Klarheit.",
    },
    null,
  );
  await repository.create(
    {
      projectId: "project-1",
      organizationId: "org-1",
      term: "short",
      statement: "Manuell gepflegte Zusatzwirkung.",
    },
    null,
  );

  const result = await syncOutcomeStatementsForIntendedChanges(
    repository,
    {
      projectId: "project-1",
      organizationId: "org-1",
      previousIntendedChanges: [
        "Jugendliche gewinnen mehr berufliche Klarheit.",
      ],
      intendedChanges: ["Jugendliche setzen konkrete Karriereschritte um."],
    },
    null,
  );

  assert.deepEqual(result.deletedOutcomeStatementIds, [removed.id]);
  assert.deepEqual(result.records.map((record) => record.statement).sort(), [
    "Jugendliche setzen konkrete Karriereschritte um.",
    "Manuell gepflegte Zusatzwirkung.",
  ]);
});
