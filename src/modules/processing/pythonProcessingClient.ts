import { AppError } from "../../shared/errors/appError.js";
import type { PrivacyReviewDecisions } from "../../shared/contracts.js";

interface StartEvidenceProcessingInput {
  processingJobId: string;
  uploadMetadataId: string;
  projectId: string;
  activityId: string | null;
  storageKey: string;
  originalFileName: string;
  contentType: string | null;
  fileBuffer: Buffer;
}

interface PythonEvidenceProcessingResponse {
  externalJobId: string;
  status: "accepted" | "processing";
  acceptedAt: string;
}

interface PythonProcessingJobStatusResponse {
  externalJobId: string;
  status:
    | "accepted"
    | "processing"
    | "awaiting_privacy_review"
    | "transforming"
    | "completed"
    | "failed"
    | "cancelled";
  updatedAt: string;
  errorMessage?: string | null;
  details?: Record<string, unknown> | null;
}

interface ApprovePrivacyReviewResponse {
  externalJobId: string;
  status: "transforming" | "completed";
  updatedAt: string;
  details?: Record<string, unknown> | null;
}

interface StartDatasetInterpretationActivityGoals {
  objectives: string | null;
  successIndicators: string | null;
}

interface StartDatasetInterpretationProjectImpactModel {
  inputs: string | null;
  activities: string | null;
  outputs: string | null;
  outcomes: string | null;
  impact: string | null;
}

interface StartDatasetInterpretationProjectGoals {
  impactModel: StartDatasetInterpretationProjectImpactModel | null;
  successIndicators: string | null;
}

interface StartDatasetInterpretationInput {
  processingJobId: string;
  privacySafeRepresentationId: string;
  payload: Record<string, unknown>;
  language: "de" | "en";
  activityGoals: StartDatasetInterpretationActivityGoals | null;
  projectGoals: StartDatasetInterpretationProjectGoals | null;
}

interface PythonDatasetInterpretationResponse {
  externalJobId: string;
  status: "accepted" | "processing";
  acceptedAt: string;
}

export class PythonProcessingClient {
  constructor(
    private readonly baseUrl: string,
    private readonly sharedSecret: string,
  ) {}

  private authHeaders(): Record<string, string> {
    return { "x-internal-service-token": this.sharedSecret };
  }

  async startEvidenceProcessing(
    input: StartEvidenceProcessingInput,
  ): Promise<PythonEvidenceProcessingResponse> {
    const formData = new FormData();
    formData.set("processingJobId", input.processingJobId);
    formData.set("uploadMetadataId", input.uploadMetadataId);
    formData.set("projectId", input.projectId);
    if (input.activityId) {
      formData.set("activityId", input.activityId);
    }
    formData.set("storageKey", input.storageKey);
    formData.set("originalFileName", input.originalFileName);
    if (input.contentType) {
      formData.set("contentType", input.contentType);
    }
    formData.set(
      "file",
      new Blob([new Uint8Array(input.fileBuffer)], {
        type: input.contentType ?? "application/octet-stream",
      }),
      input.originalFileName,
    );

    const response = await fetch(`${this.baseUrl}/processing/evidence`, {
      method: "POST",
      headers: this.authHeaders(),
      body: formData,
    });

    if (!response.ok) {
      throw new AppError(
        "The Python processing service did not accept the evidence job.",
        502,
        "python_processing_unavailable",
      );
    }

    return response.json() as Promise<PythonEvidenceProcessingResponse>;
  }

  async getProcessingJobStatus(
    externalJobId: string,
  ): Promise<PythonProcessingJobStatusResponse> {
    const response = await fetch(
      `${this.baseUrl}/processing/jobs/${externalJobId}`,
      { headers: this.authHeaders() },
    );

    if (!response.ok) {
      throw new AppError(
        "The Python processing service did not return a job status.",
        502,
        "python_processing_status_unavailable",
      );
    }

    return response.json() as Promise<PythonProcessingJobStatusResponse>;
  }

  async approvePrivacyReview(
    externalJobId: string,
    decisions: PrivacyReviewDecisions,
  ): Promise<ApprovePrivacyReviewResponse> {
    const response = await fetch(
      `${this.baseUrl}/processing/jobs/${externalJobId}/approve`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...this.authHeaders(),
        },
        body: JSON.stringify({ decisions }),
      },
    );

    if (!response.ok) {
      throw new AppError(
        "The Python processing service did not accept the privacy approval.",
        502,
        "python_processing_privacy_approval_unavailable",
      );
    }

    return response.json() as Promise<ApprovePrivacyReviewResponse>;
  }

  async startDatasetInterpretation(
    input: StartDatasetInterpretationInput,
  ): Promise<PythonDatasetInterpretationResponse> {
    const response = await fetch(`${this.baseUrl}/processing/interpretation`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...this.authHeaders(),
      },
      body: JSON.stringify({
        processingJobId: input.processingJobId,
        privacySafeRepresentationId: input.privacySafeRepresentationId,
        payload: input.payload,
        language: input.language,
        activityGoals: input.activityGoals,
        projectGoals: input.projectGoals,
      }),
    });

    if (!response.ok) {
      throw new AppError(
        "The Python processing service did not accept the interpretation job.",
        502,
        "python_processing_interpretation_unavailable",
      );
    }

    return response.json() as Promise<PythonDatasetInterpretationResponse>;
  }
}
