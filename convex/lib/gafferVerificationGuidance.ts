type Verification = { status?: string | null; expired?: boolean } | null | undefined;

export function verificationRecovery(message: string, verification: Verification): string | null {
  const text = message.toLowerCase();
  if (!/\b(didit|verif(?:y|ied|ication)|identity|selfie|proof of address|id (?:upload|capture|photo|document))\b/.test(text)) return null;
  if (!/\b(stuck|cannot|can't|cant|couldn't|couldnt|won't|wont|unable|missing|nowhere|no (?:button|way|option)|not (?:working|loading|opening|showing|visible)|error|problem|issue|button|upload)\b/.test(text)) return null;
  if (/\b(human|person|someone|staff|manager|team|operator|representative|refund\w*|cancel\w*|disput\w*|chargeback\w*|damage\w*|fraud\w*|threat\w*|injur\w*|abus\w*|harm\w*|suicid\w*|unsafe|safety|safeguard\w*|urgent emergency|speak (?:to|with)|talk (?:to|with)|call me)\b/.test(text)) return null;
  if (!verification) return null;
  if (verification.status === "verified" && !verification.expired) return "Your verification is recorded as approved, so you don't need to repeat the ID capture. Please check this rental conversation for the next steps.";
  if (verification.status === "manual_review") return "Your verification is recorded as needing review. You can use Request a human in this conversation if you need help; I can't complete the provider's review for you.";
  if (verification.status === "rejected") return "The verification is recorded as declined. Please use Request a human in this conversation so we can help with the next step; don't send your ID in chat.";
  const mobile = /\b(phone|mobile|iphone|ipad|android)\b/.test(text);
  return mobile
    ? "Please scroll down inside the verification page to look for the capture or continue button. If it is still missing, tap Open verification and uploads in this rental and try again in your phone's browser. Don't send your ID in chat. If you're still stuck, use Request a human here."
    : "Please select Open verification and uploads in this rental and follow the provider's prompts. If a button is missing, scroll down within the verification page and try again. Don't send your ID in chat. If you're still stuck, use Request a human here.";
}
