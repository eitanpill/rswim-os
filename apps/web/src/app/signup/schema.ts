import { z } from 'zod';

/** A new business owner's account. Messages are i18n keys under `account.signup.errors`. */
export const SignupInput = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'account.signup.errors.name')
    .max(80, 'account.signup.errors.name'),
  email: z.string().trim().toLowerCase().email('account.signup.errors.email').max(200),
  password: z
    .string()
    .min(8, 'account.signup.errors.password')
    .max(72, 'account.signup.errors.password'),
  terms: z.literal('on', { message: 'account.signup.errors.terms' }),
});
export type SignupInput = z.infer<typeof SignupInput>;
