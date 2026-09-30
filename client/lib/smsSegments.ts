/** Twilio concatenated SMS ceiling used across Conversations + MCP send_sms. */
export const SMS_MAX_BODY_CHARS = 1600;

const GSM_7_REGEX =
  /^[@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&'()*+,\-./0-9:;<=>?¡A-ZÄÖÑÜ§¿a-zäöñüà^{}\\\[~\]|€]*$/;

export type SmsSegmentInfo = {
  length: number;
  maxChars: number;
  segments: number;
  charsPerSegment: number;
  encoding: "gsm" | "ucs2";
};

export function isGsm7(text: string): boolean {
  return GSM_7_REGEX.test(text);
}

/** Segment count for outbound SMS (GSM-7 vs UCS-2). */
export function smsSegmentInfo(text: string): SmsSegmentInfo {
  const length = [...text].length;
  const encoding = isGsm7(text) ? "gsm" : "ucs2";
  const singleLimit = encoding === "gsm" ? 160 : 70;
  const multiLimit = encoding === "gsm" ? 153 : 67;
  const segments =
    length === 0
      ? 0
      : length <= singleLimit
        ? 1
        : Math.ceil(length / multiLimit);
  return {
    length,
    maxChars: SMS_MAX_BODY_CHARS,
    segments,
    charsPerSegment: segments <= 1 ? singleLimit : multiLimit,
    encoding,
  };
}
