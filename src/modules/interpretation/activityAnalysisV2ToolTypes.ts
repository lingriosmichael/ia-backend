// Shared request/result type declarations for ActivityAnalysisV2 tools.
// Split out of activityAnalysisV2ToolExecutor.ts so the per-tool-family
// implementation modules and the orchestrating executor class can each
// import just the types they need without pulling in unrelated logic.
import type {
  ActivityAnalysisV2CalculationRecord,
  ActivityAnalysisV2QualitativeFindingRecord,
  ActivityAnalysisV2ToolCallRecord,
  ActivityAnalysisV2ToolName,
  PreparedDatasetTable,
} from "../../shared/contracts.js";

export interface ActivityAnalysisV2TableContext {
  uploadMetadataId: string;
  privacySafeRepresentationId: string;
  tableName: string;
  rows: Record<string, unknown>[];
  preparedTable: PreparedDatasetTable | null;
}

export interface BaseToolRequest {
  toolName: ActivityAnalysisV2ToolName;
  arguments: Record<string, unknown>;
}

export type ActivityAnalysisV2FilterOperator =
  | "equals"
  | "not_equals"
  | "in"
  | "not_in"
  | "greater_than"
  | "greater_than_or_equal"
  | "less_than"
  | "less_than_or_equal"
  | "contains"
  | "is_null"
  | "is_not_null";

export type ActivityAnalysisV2FilterValue = string | number | boolean | null;

export interface ActivityAnalysisV2FilterCondition {
  columnName: string;
  operator: ActivityAnalysisV2FilterOperator;
  value?: ActivityAnalysisV2FilterValue | ActivityAnalysisV2FilterValue[];
}

export interface ActivityAnalysisV2RowSourceReference {
  uploadMetadataId?: string;
  tableName?: string;
  cohortAlias?: string;
  resultAlias?: string;
  useAnalysisRows?: boolean;
  filters?: ActivityAnalysisV2FilterCondition[];
}

export interface ActivityAnalysisV2SetSourceReference extends ActivityAnalysisV2RowSourceReference {
  columnName?: string;
}

export interface ActivityAnalysisV2JoinKey {
  leftColumnName: string;
  rightColumnName: string;
}

export type ActivityAnalysisV2GroupAggregateMetricOperation =
  "count" | "count_distinct" | "sum" | "avg" | "min" | "max" | "median";

export type ActivityAnalysisV2DerivedNumericOperation =
  "add" | "subtract" | "multiply" | "divide";

export type ActivityAnalysisV2ColumnComparisonOperation =
  | "greater_than"
  | "greater_than_or_equal"
  | "less_than"
  | "less_than_or_equal"
  | "equal"
  | "not_equal";

export interface ActivityAnalysisV2GroupAggregateMetric {
  alias: string;
  operation: ActivityAnalysisV2GroupAggregateMetricOperation;
  columnName?: string;
}

export type ActivityAnalysisV2ToolRequest = {
  goalId?: string;
} & (
  | {
      toolName: "describe_evidence";
      alias?: string;
      arguments: Record<string, never>;
    }
  | {
      toolName: "excerpt_retrieval";
      alias?: string;
      arguments: {
        uploadMetadataId?: string;
        tableName?: string;
        cohortAlias?: string;
        resultAlias?: string;
        columnName: string;
        limit?: number;
        useAnalysisRows?: boolean;
        filters?: ActivityAnalysisV2FilterCondition[];
      };
    }
  | {
      toolName: "create_cohort";
      alias?: string;
      arguments: ActivityAnalysisV2RowSourceReference;
    }
  | {
      toolName: "filter_result";
      alias?: string;
      arguments: ActivityAnalysisV2RowSourceReference;
    }
  | {
      toolName: "join_tables";
      alias?: string;
      arguments: {
        left: ActivityAnalysisV2RowSourceReference;
        right: ActivityAnalysisV2RowSourceReference;
        keys: ActivityAnalysisV2JoinKey[];
        leftPrefix?: string;
        rightPrefix?: string;
      };
    }
  | {
      toolName: "anti_join";
      alias?: string;
      arguments: {
        left: ActivityAnalysisV2RowSourceReference;
        right: ActivityAnalysisV2RowSourceReference;
        keys: ActivityAnalysisV2JoinKey[];
      };
    }
  | {
      toolName: "derive_numeric_column";
      alias?: string;
      arguments: {
        uploadMetadataId?: string;
        tableName?: string;
        cohortAlias?: string;
        resultAlias?: string;
        leftColumnName: string;
        rightColumnName: string;
        operation: ActivityAnalysisV2DerivedNumericOperation;
        outputColumnName: string;
        useAnalysisRows?: boolean;
        filters?: ActivityAnalysisV2FilterCondition[];
      };
    }
  | {
      toolName: "compare_columns";
      alias?: string;
      arguments: {
        uploadMetadataId?: string;
        tableName?: string;
        cohortAlias?: string;
        resultAlias?: string;
        leftColumnName: string;
        rightColumnName: string;
        comparison: ActivityAnalysisV2ColumnComparisonOperation;
        outputColumnName: string;
        useAnalysisRows?: boolean;
        filters?: ActivityAnalysisV2FilterCondition[];
      };
    }
  | {
      toolName: "profile_column";
      alias?: string;
      arguments: {
        uploadMetadataId?: string;
        tableName?: string;
        cohortAlias?: string;
        resultAlias?: string;
        columnName: string;
        useAnalysisRows?: boolean;
        filters?: ActivityAnalysisV2FilterCondition[];
      };
    }
  | {
      toolName: "count_rows";
      alias?: string;
      arguments: ActivityAnalysisV2RowSourceReference;
    }
  | {
      toolName: "count_distinct";
      alias?: string;
      arguments: {
        uploadMetadataId?: string;
        tableName?: string;
        cohortAlias?: string;
        resultAlias?: string;
        columnName: string;
        useAnalysisRows?: boolean;
        filters?: ActivityAnalysisV2FilterCondition[];
      };
    }
  | {
      toolName: "count_distinct_keys";
      alias?: string;
      arguments: {
        uploadMetadataId?: string;
        tableName?: string;
        cohortAlias?: string;
        resultAlias?: string;
        columnNames: string[];
        useAnalysisRows?: boolean;
        filters?: ActivityAnalysisV2FilterCondition[];
      };
    }
  | {
      toolName: "group_count";
      alias?: string;
      arguments: {
        uploadMetadataId?: string;
        tableName?: string;
        cohortAlias?: string;
        resultAlias?: string;
        columnName: string;
        useAnalysisRows?: boolean;
        filters?: ActivityAnalysisV2FilterCondition[];
      };
    }
  | {
      toolName: "crosstab_count";
      alias?: string;
      arguments: {
        uploadMetadataId?: string;
        tableName?: string;
        cohortAlias?: string;
        resultAlias?: string;
        leftColumnName: string;
        rightColumnName: string;
        useAnalysisRows?: boolean;
        filters?: ActivityAnalysisV2FilterCondition[];
      };
    }
  | {
      toolName: "group_aggregate";
      alias?: string;
      arguments: {
        uploadMetadataId?: string;
        tableName?: string;
        cohortAlias?: string;
        resultAlias?: string;
        groupBy: string[];
        metrics: ActivityAnalysisV2GroupAggregateMetric[];
        useAnalysisRows?: boolean;
        filters?: ActivityAnalysisV2FilterCondition[];
      };
    }
  | {
      toolName: "aggregate_numeric";
      alias?: string;
      arguments: {
        uploadMetadataId?: string;
        tableName?: string;
        cohortAlias?: string;
        resultAlias?: string;
        columnName: string;
        operation: "sum" | "avg" | "min" | "max";
        useAnalysisRows?: boolean;
        filters?: ActivityAnalysisV2FilterCondition[];
      };
    }
  | {
      toolName: "intersection_count";
      alias?: string;
      arguments: {
        left: ActivityAnalysisV2SetSourceReference;
        right: ActivityAnalysisV2SetSourceReference;
      };
    }
  | {
      toolName: "intersection_set";
      alias?: string;
      arguments: {
        left: ActivityAnalysisV2SetSourceReference;
        right: ActivityAnalysisV2SetSourceReference;
      };
    }
  | {
      toolName: "union_count";
      alias?: string;
      arguments: {
        left: ActivityAnalysisV2SetSourceReference;
        right: ActivityAnalysisV2SetSourceReference;
      };
    }
  | {
      toolName: "union_set";
      alias?: string;
      arguments: {
        left: ActivityAnalysisV2SetSourceReference;
        right: ActivityAnalysisV2SetSourceReference;
      };
    }
  | {
      toolName: "difference_set";
      alias?: string;
      arguments: {
        left: ActivityAnalysisV2SetSourceReference;
        right: ActivityAnalysisV2SetSourceReference;
      };
    }
  | {
      toolName: "first_event";
      alias?: string;
      arguments: {
        uploadMetadataId?: string;
        tableName?: string;
        cohortAlias?: string;
        resultAlias?: string;
        entityColumnName: string;
        dateColumnName: string;
        outputDateColumnName: string;
        useAnalysisRows?: boolean;
        filters?: ActivityAnalysisV2FilterCondition[];
      };
    }
  | {
      toolName: "last_event";
      alias?: string;
      arguments: {
        uploadMetadataId?: string;
        tableName?: string;
        cohortAlias?: string;
        resultAlias?: string;
        entityColumnName: string;
        dateColumnName: string;
        outputDateColumnName: string;
        useAnalysisRows?: boolean;
        filters?: ActivityAnalysisV2FilterCondition[];
      };
    }
  | {
      toolName: "date_difference";
      alias?: string;
      arguments: {
        uploadMetadataId?: string;
        tableName?: string;
        cohortAlias?: string;
        resultAlias?: string;
        startDateColumnName: string;
        endDateColumnName: string;
        outputColumnName: string;
        unit: "days";
        useAnalysisRows?: boolean;
        filters?: ActivityAnalysisV2FilterCondition[];
      };
    }
  | {
      toolName: "event_gap";
      alias?: string;
      arguments: {
        uploadMetadataId?: string;
        tableName?: string;
        cohortAlias?: string;
        resultAlias?: string;
        entityColumnName: string;
        dateColumnName: string;
        outputColumnName: string;
        useAnalysisRows?: boolean;
        filters?: ActivityAnalysisV2FilterCondition[];
      };
    }
  | {
      toolName: "days_since_last_event";
      alias?: string;
      arguments: {
        uploadMetadataId?: string;
        tableName?: string;
        cohortAlias?: string;
        resultAlias?: string;
        entityColumnName: string;
        dateColumnName: string;
        outputColumnName: string;
        outputDateColumnName?: string;
        referenceDate?: string;
        useAnalysisRows?: boolean;
        filters?: ActivityAnalysisV2FilterCondition[];
      };
    }
  | {
      toolName: "period_change";
      alias?: string;
      arguments: {
        uploadMetadataId?: string;
        tableName?: string;
        cohortAlias?: string;
        resultAlias?: string;
        dateColumnName: string;
        baselineStartDate: string;
        baselineEndDate: string;
        comparisonStartDate: string;
        comparisonEndDate: string;
        useAnalysisRows?: boolean;
        filters?: ActivityAnalysisV2FilterCondition[];
      };
    }
  | {
      toolName: "paired_change";
      alias?: string;
      arguments: {
        uploadMetadataId?: string;
        tableName?: string;
        cohortAlias?: string;
        resultAlias?: string;
        entityColumnName: string;
        preColumnName: string;
        postColumnName: string;
        outputColumnName: string;
        useAnalysisRows?: boolean;
        filters?: ActivityAnalysisV2FilterCondition[];
      };
    }
  | {
      toolName: "time_bucket_count";
      alias?: string;
      arguments: {
        uploadMetadataId?: string;
        tableName?: string;
        cohortAlias?: string;
        resultAlias?: string;
        columnName: string;
        granularity: "day" | "week" | "month" | "quarter" | "year";
        useAnalysisRows?: boolean;
        filters?: ActivityAnalysisV2FilterCondition[];
      };
    }
  | {
      toolName: "calculate_ratio";
      alias?: string;
      arguments: {
        numeratorAlias: string;
        denominatorAlias: string;
        label?: string;
      };
    }
  | {
      toolName: "calculate_difference";
      alias?: string;
      arguments: {
        minuendAlias: string;
        subtrahendAlias: string;
        label?: string;
      };
    }
  | {
      toolName: "calculate_percent_change";
      alias?: string;
      arguments: {
        baselineAlias: string;
        currentAlias: string;
        label?: string;
      };
    }
  | {
      toolName: "calculate_sum";
      alias?: string;
      arguments: {
        operandAliases: string[];
        label?: string;
      };
    }
  | {
      toolName: "calculate_product";
      alias?: string;
      arguments: {
        operandAliases: string[];
        label?: string;
      };
    }
  | {
      toolName: "compare_target";
      alias?: string;
      arguments: {
        valueAlias: string;
        target: number;
        comparison: "at_least" | "at_most" | "equal";
        label?: string;
      };
    }
);

export interface ActivityAnalysisV2ToolExecutionResult {
  toolCallTrace: ActivityAnalysisV2ToolCallRecord[];
  calculations: ActivityAnalysisV2CalculationRecord[];
  qualitativeFindings: ActivityAnalysisV2QualitativeFindingRecord[];
}
