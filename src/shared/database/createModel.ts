import mongoose, { type Model, type Schema } from "mongoose";

export function createModel<TDocument>(
  modelName: string,
  schema: Schema<TDocument>,
): Model<TDocument> {
  return ((mongoose.models[modelName] as Model<TDocument> | undefined) ??
    mongoose.model<TDocument>(modelName, schema)) as Model<TDocument>;
}
