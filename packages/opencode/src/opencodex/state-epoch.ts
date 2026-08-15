import { randomUUID } from "node:crypto"
import { EPOCH } from "./state-schema"

export const AUTHORITY_EPOCH = `${EPOCH}:${randomUUID()}`
