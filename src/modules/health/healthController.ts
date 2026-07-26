export class HealthController {
  async getHealth() {
    return {
      status: "ok",
      service: "brindl-backend",
      timestamp: new Date().toISOString(),
    };
  }
}
