import { Schema, type HydratedDocument, type InferSchemaType } from "mongoose";
import { createModel } from "../../shared/database/createModel.js";

const userSchema = new Schema(
  {
    _id: { type: String, required: true },
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    fullName: { type: String, required: true, trim: true },
    passwordHash: { type: String, required: true },
  },
  {
    collection: "users",
    timestamps: true,
  },
);

export type UserMongoDocument = InferSchemaType<typeof userSchema>;
export type UserMongoHydratedDocument = HydratedDocument<UserMongoDocument>;
export const UserMongoModel = createModel("User", userSchema);
