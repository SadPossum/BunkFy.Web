export const authPasswordPolicy = Object.freeze({
  minimumLength: 15,
  maximumLength: 128,
});

export function authPasswordLengthHelp(): string {
  return `${authPasswordPolicy.minimumLength}-${authPasswordPolicy.maximumLength} characters`;
}
