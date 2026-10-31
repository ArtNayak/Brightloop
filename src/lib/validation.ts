import { z } from "zod";

// more than 8 chars, upper, lower, special
export const passwordSchema = z
  .string()
  .min(9, "Password must be more than 8 characters")
  .regex(/[A-Z]/, "Needs an uppercase letter")
  .regex(/[a-z]/, "Needs a lowercase letter")
  .regex(/[^A-Za-z0-9]/, "Needs a special character");

export const emailSchema = z.string().trim().toLowerCase().email();
