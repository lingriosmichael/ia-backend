import { AppError } from "../../shared/errors/appError.js";

interface StartEvidenceProcessingInput {
  processingJobId: string;
  uploadMetadataId: string;
  projectId: string;
  activityId: string | null;
  storageKey: string;
  originalFileName: string;
  contentType: string | null;
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

export class PythonProcessingClient {
  constructor(private readonly baseUrl: string) {}

  async startEvidenceProcessing(
    input: StartEvidenceProcessingInput,
  ): Promise<PythonEvidenceProcessingResponse> {
    const response = await fetch(`${this.baseUrl}/processing/evidence`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(input),
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
}
