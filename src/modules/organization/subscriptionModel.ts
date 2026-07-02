import { Schema, type HydratedDocument, type InferSchemaType } from "mongoose";
import { createModel } from "../../shared/database/createModel.js";

const subscriptionSchema = new Schema(
  {
    _id: { type: String, required: true },
    organizationId: { type: String, required: true, index: true, unique: true },
    planName: { type: String, required: true, trim: true },
    includedAdminSeats: { type: Number, required: true, min: 0 },
    includedProjectManagerSeats: { type: Number, required: true, min: 0 },
    status: { type: String, required: true, trim: true },
  },
  {
    collection: "subscriptions",
    timestamps: true,
  },
);

export type SubscriptionMongoDocument = InferSchemaType<typeof subscriptionSchema>;
export type SubscriptionMongoHydratedDocument =
  HydratedDocument<SubscriptionMongoDocument>;
export const SubscriptionMongoModel = createModel("Subscription", subscriptionSchema);
