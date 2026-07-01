import { AIExecutionRunnerService } from "./ai-execution-runner.service.js";

export class MockJobRunnerService {
  constructor(
    private readonly executionRunnerService: AIExecutionRunnerService,
  ) {}

  schedule(jobId: string) {
    setTimeout(() => {
      void this.run(jobId);
    }, 250);
  }

  private async run(jobId: string) {
    try {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      await this.executionRunnerService.run(jobId);
    } catch (error) {
      console.error("Mock worker execution failed.", {
        jobId,
        error,
      });
    }
  }
}
