import assert from "node:assert/strict";
import test from "node:test";
import { Readable } from "node:stream";
import type { FastifyReply, FastifyRequest } from "fastify";
import { UploadMetadataController } from "./uploadMetadataController.js";

test("getFile returns an RFC-compliant UTF-8 content-disposition header for Unicode filenames", async () => {
  const fileStream = Readable.from([Buffer.from("file")]);
  const controller = new UploadMetadataController(
    {
      getFile: async () => ({
        stream: fileStream,
        contentType: "application/pdf",
        originalFileName: "Förderbericht März 2026.pdf",
      }),
    } as never,
    {} as never,
  );

  const headers = new Map<string, string>();
  let sentBody: unknown = null;
  let replyType: string | null = null;
  const reply = {
    type(value: string) {
      replyType = value;
      return this;
    },
    header(name: string, value: string) {
      headers.set(name, value);
      return this;
    },
    send(body: unknown) {
      sentBody = body;
      return this;
    },
  } as unknown as FastifyReply;

  await controller.getFile(
    {
      auth: {
        userId: "user-1",
        email: "user@example.com",
      },
      params: {
        evidenceId: "upload-1",
      },
    } as FastifyRequest,
    reply,
  );

  assert.equal(replyType, "application/pdf");
  assert.equal(sentBody, fileStream);
  assert.equal(
    headers.get("content-disposition"),
    `inline; filename="Foerderbericht Maerz 2026.pdf"; filename*=UTF-8''F%C3%B6rderbericht%20M%C3%A4rz%202026.pdf`,
  );
});
