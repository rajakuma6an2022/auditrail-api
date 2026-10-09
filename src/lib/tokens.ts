import { createHash, randomBytes } from "node:crypto";

// Raw token goes in the email link. Only the SHA-256 hash is stored in the DB.
export const generateToken = () => randomBytes(32).toString("base64url");

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");