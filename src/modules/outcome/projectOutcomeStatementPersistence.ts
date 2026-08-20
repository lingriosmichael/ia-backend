import type { OutcomeTerm } from "../../shared/contracts.js";

export interface ProjectOutcomeStatementPersistenceRecord {
  id: string;
  projectId: string;
  organizationId: string;
  term: OutcomeTerm;
  statement: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectOutcomeStatementCreateInput {
  projectId: string;
  organizationId: string;
  term: OutcomeTerm;
  statement: string;
}

export interface ProjectOutcomeStatementUpdateInput {
  term?: OutcomeTerm;
  statement?: string;
}
