import type {
  BrowserAuthResponse,
  MultiFactorChallenge,
  MultiFactorCodeType,
} from "../../api/types";

export function isMultiFactorChallenge(
  response: BrowserAuthResponse | MultiFactorChallenge,
): response is MultiFactorChallenge {
  return "challengeToken" in response &&
    typeof response.challengeToken === "string";
}

export function preferredMultiFactorCodeType(
  challenge: Pick<MultiFactorChallenge, "availableCodeTypes">,
): MultiFactorCodeType | null {
  if (challenge.availableCodeTypes.includes("totp")) return "totp";
  return challenge.availableCodeTypes[0] ?? null;
}
