export class HealthController {
  async getHealth() {
    return {
      status: "ok",
      service: "gr-backend",
      timestamp: new Date().toISOString(),
    };
  }
}
