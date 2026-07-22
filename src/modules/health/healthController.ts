export class HealthController {
  async getHealth() {
    return {
      status: "ok",
      service: "impact-atlas-backend",
      timestamp: new Date().toISOString(),
    };
  }
}
