import nodemailer, { type Transporter } from "nodemailer";

// We keep one SMTP connection setup around instead of making a new one for every email.
let transport: Transporter | undefined;

function getTransport() {
  // Only build it the first time someone actually sends mail, so the app still starts
  // fine even if the SMTP settings in .env are missing.
  return (transport ??= nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 2525), // 2525 is Mailtrap's default port
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  }));
}

// Use this anywhere we need to email someone (password reset, sending an invoice, ...).
// It throws if the mail server refuses, so callers decide whether that is fatal.
export async function sendMail({ to, subject, html }: { to: string; subject: string; html: string }) {
  await getTransport().sendMail({
    from: process.env.MAIL_FROM ?? "Brightloop <noreply@brightloop.test>",
    to,
    subject,
    html,
  });
}
