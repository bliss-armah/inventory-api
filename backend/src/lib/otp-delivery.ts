import { sendEmail } from "./email.ts";
import { sendSms } from "./sms.ts";
import { OtpChannel } from "../generated/prisma/enums.ts";

const SUBJECT = "Your Inventory Manager verification code";

/**
 * The single place that turns "user X needs code Y" into an actual outbound
 * message. Callers pick a channel and a destination; which vendor carries it
 * (Brevo for email, Vynfy for SMS) stays here, as does the wording — so the
 * copy can't drift between the two channels.
 */
export async function deliverOtp(input: {
  channel: OtpChannel;
  destination: string;
  code: string;
  minutes: number;
}): Promise<void> {
  const body = `Your Inventory Manager verification code is ${input.code}. It expires in ${input.minutes} minutes.`;

  if (input.channel === OtpChannel.EMAIL) {
    await sendEmail(input.destination, SUBJECT, body);
    return;
  }
  await sendSms(input.destination, body);
}
