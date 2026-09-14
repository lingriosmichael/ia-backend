## Dead Legacy Code Notes

### 2026-08-27

Approved dead-legacy cleanup scope:

- Only the explicit `Als geprueft markieren` interpretation-acknowledgment flow.
- Remove code that exists only to trigger, transport, or persist that action.

In scope:

- Webapp button wiring for the explicit acknowledgment action.
- The direct mutation/API client call chain behind that button.
- The backend interpretation-acknowledgment endpoint and service path behind that action.

Out of scope:

- The broader `reviewed` state unless a specific code path exists only for the acknowledgment action above.
- Generic `prueft` / `reviewed` wording elsewhere.
- Other interpretation, analysis, or workflow behavior that is not directly part of the explicit acknowledgment action.

Removed on 2026-08-27:

- Webapp `Als geprueft markieren` button and related acknowledgment-only copy.
- Webapp interpretation-acknowledgment mutation hook and API client method.
- Backend interpretation-acknowledgment route, controller action, service method, and direct method tests.
